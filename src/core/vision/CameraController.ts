import { CameraStatus, CameraDiagnosticMetrics } from '../../types/vision';

export type CameraStatusListener = (metrics: CameraDiagnosticMetrics) => void;

export class CameraController {
  private stream: MediaStream | null = null;
  private videoElement: HTMLVideoElement | null = null;
  private listeners: Set<CameraStatusListener> = new Set();

  private status: CameraStatus = 'IDLE';
  private errorMessage: string | null = null;
  private videoWidth: number = 0;
  private videoHeight: number = 0;

  // FPS & Latency tracking
  private frameCount: number = 0;
  private lastFpsCalcTime: number = performance.now();
  private currentFps: number = 0;
  private lastFrameLatency: number = 0;

  private onTrackEndedHandler: (() => void) | null = null;
  private onDeviceChangeHandler: (() => void) | null = null;

  constructor(
    private targetWidth: number = 640,
    private targetHeight: number = 480,
    private idealFrameRate: number = 30
  ) {
    this.setupDeviceChangeListener();
  }

  private setupDeviceChangeListener(): void {
    if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
      this.onDeviceChangeHandler = () => {
        // If actively streaming and camera track ended or disconnected
        if (this.status === 'ACTIVE' && this.stream) {
          const videoTracks = this.stream.getVideoTracks();
          if (videoTracks.length === 0 || videoTracks[0].readyState === 'ended') {
            this.handleDisconnection('Camera was disconnected from the system.');
          }
        }
      };
      navigator.mediaDevices.addEventListener('devicechange', this.onDeviceChangeHandler);
    }
  }

  public subscribe(listener: CameraStatusListener): () => void {
    this.listeners.add(listener);
    listener(this.getMetrics());
    return () => this.listeners.delete(listener);
  }

  private setStatus(status: CameraStatus, error: string | null = null): void {
    this.status = status;
    this.errorMessage = error;
    this.notify();
  }

  public getMetrics(): CameraDiagnosticMetrics {
    return {
      status: this.status,
      errorMessage: this.errorMessage,
      fps: this.currentFps,
      frameLatencyMs: this.lastFrameLatency,
      videoWidth: this.videoWidth,
      videoHeight: this.videoHeight,
    };
  }

  private notify(): void {
    const metrics = this.getMetrics();
    this.listeners.forEach((l) => l(metrics));
  }

  public recordFrameProcessed(latencyMs: number): void {
    this.frameCount++;
    this.lastFrameLatency = latencyMs;
    const now = performance.now();
    if (now - this.lastFpsCalcTime >= 1000) {
      this.currentFps = Math.round((this.frameCount * 1000) / (now - this.lastFpsCalcTime));
      this.frameCount = 0;
      this.lastFpsCalcTime = now;
      this.notify();
    }
  }

  /**
   * Request webcam stream only after user interaction
   */
  public async start(videoElement?: HTMLVideoElement): Promise<MediaStream> {
    // If already active, return current stream
    if (this.status === 'ACTIVE' && this.stream && this.stream.active) {
      return this.stream;
    }

    this.setStatus('REQUESTING_PERMISSION');

    try {
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        throw new Error('navigator.mediaDevices.getUserMedia is not supported in this context.');
      }

      const constraints: MediaStreamConstraints = {
        audio: false,
        video: {
          width: { ideal: this.targetWidth },
          height: { ideal: this.targetHeight },
          frameRate: { ideal: this.idealFrameRate, max: 30 },
          facingMode: 'user',
        },
      };

      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      this.stream = stream;

      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        this.onTrackEndedHandler = () => {
          this.handleDisconnection('Webcam hardware stream ended or disconnected.');
        };
        videoTrack.addEventListener('ended', this.onTrackEndedHandler);
      }

      // Attach to provided or internal video element
      let video = videoElement;
      if (!video) {
        video = document.createElement('video');
        video.style.position = 'fixed';
        video.style.top = '-9999px';
        video.style.left = '-9999px';
        video.style.opacity = '0';
        video.style.pointerEvents = 'none';
        video.setAttribute('playsinline', '');
        video.setAttribute('autoplay', '');
        video.setAttribute('muted', '');
        document.body.appendChild(video);
      }

      this.videoElement = video;
      video.srcObject = stream;
      video.muted = true;

      await new Promise<void>((resolve, reject) => {
        video!.onloadedmetadata = () => {
          video!.play()
            .then(() => {
              this.videoWidth = video!.videoWidth || this.targetWidth;
              this.videoHeight = video!.videoHeight || this.targetHeight;
              resolve();
            })
            .catch(reject);
        };
        video!.onerror = () => reject(new Error('Video element failed to play stream.'));
      });

      this.setStatus('ACTIVE');
      return stream;
    } catch (err: unknown) {
      let status: CameraStatus = 'ERROR';
      let message = 'Failed to acquire camera stream.';

      if (err instanceof DOMException) {
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          status = 'PERMISSION_DENIED';
          message = 'Camera permission was denied. Please allow camera access in Chrome settings.';
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
          status = 'DEVICE_DISCONNECTED';
          message = 'No webcam was detected on this device.';
        } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
          status = 'ERROR';
          message = 'Webcam is currently in use by another application or process.';
        } else if (err.name === 'OverconstrainedError') {
          status = 'ERROR';
          message = 'Camera does not meet requested resolution or frame-rate constraints.';
        }
      } else if (err instanceof Error) {
        message = err.message;
      }

      this.setStatus(status, message);
      this.cleanupStream();
      throw new Error(message);
    }
  }

  private handleDisconnection(reason: string): void {
    console.warn('[Handsfree CameraController] Disconnection:', reason);
    this.setStatus('DEVICE_DISCONNECTED', reason);
    this.cleanupStream();
  }

  private cleanupStream(): void {
    if (this.stream) {
      const tracks = this.stream.getTracks();
      tracks.forEach((track) => {
        if (this.onTrackEndedHandler) {
          track.removeEventListener('ended', this.onTrackEndedHandler);
        }
        track.stop();
      });
      this.stream = null;
    }

    if (this.videoElement) {
      this.videoElement.srcObject = null;
      if (this.videoElement.parentNode && this.videoElement.style.display === 'none') {
        this.videoElement.parentNode.removeChild(this.videoElement);
      }
      this.videoElement = null;
    }

    this.videoWidth = 0;
    this.videoHeight = 0;
    this.currentFps = 0;
  }

  /**
   * Release camera hardware and reset status
   */
  public stop(): void {
    this.cleanupStream();
    this.setStatus('STOPPED');
  }

  public dispose(): void {
    this.stop();
    if (typeof navigator !== 'undefined' && navigator.mediaDevices && this.onDeviceChangeHandler) {
      navigator.mediaDevices.removeEventListener('devicechange', this.onDeviceChangeHandler);
    }
    this.listeners.clear();
  }
}
