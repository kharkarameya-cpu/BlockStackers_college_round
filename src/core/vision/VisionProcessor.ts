import {
  FilesetResolver,
  HandLandmarker,
  HandLandmarkerResult,
  FaceLandmarker,
  FaceLandmarkerResult,
  NormalizedLandmark,
} from '@mediapipe/tasks-vision';
import {
  TrackingResult,
  TrackingQuality,
  FaceBoundingBox,
  DetectedHand,
  DetectorStatus,
  TrackingMode,
  ActiveTrackingSource,
} from '../../types/vision';
import { CameraController } from './CameraController';
import { TrackingStateMachine } from './TrackingStateMachine';
import { OpticalFlowTracker } from './OpticalFlowTracker';
import { HandGestureDetector } from './HandGestureDetector';

export type TrackingResultCallback = (
  result: TrackingResult,
  rawLandmarks?: NormalizedLandmark[]
) => void;

export class VisionProcessor {
  private faceLandmarker: FaceLandmarker | null = null;
  private handLandmarker: HandLandmarker | null = null;

  private isInitializing: boolean = false;
  private isProcessing: boolean = false;
  private animationFrameId: number | null = null;
  private lastVideoTime: number = -1;
  private lastFrameTime: number = 0;
  private onResultCallback: TrackingResultCallback | null = null;
  private cameraController: CameraController | null = null;
  private currentVideoElement: HTMLVideoElement | null = null;
  private fallbackTimerId: any = null;
  private videoCallbackId: any = null;

  // Independent Detector Statuses
  private faceStatus: DetectorStatus = 'UNINITIALIZED';
  private handStatus: DetectorStatus = 'UNINITIALIZED';
  private faceError: string | null = null;
  private handError: string | null = null;

  private lastFaceDetectTime: number = -1;
  private lastHandDetectTime: number = -1;
  private lastFaceSuccessTime: number = 0;
  private lastHandSuccessTime: number = 0;

  private isInferringFace: boolean = false;
  private isInferringHand: boolean = false;

  private trackingMode: TrackingMode = 'HYBRID';

  // Hand gesture recognition engine
  private gestureDetector: HandGestureDetector = new HandGestureDetector();

  // Explicit tracking state machine with configurable grace period
  private stateMachine: TrackingStateMachine = new TrackingStateMachine();
  private lastValidLandmarks: NormalizedLandmark[] | null = null;

  // Optical flow tracker for fast motion and occlusion bridge
  private opticalTracker: OpticalFlowTracker = new OpticalFlowTracker();

  // Smoothing & Stability buffer
  private recentXs: number[] = [];
  private recentYs: number[] = [];
  private readonly bufferCapacity = 10;

  constructor(cameraController?: CameraController) {
    if (cameraController) {
      this.cameraController = cameraController;
    }
  }

  public setCameraController(cameraController: CameraController): void {
    this.cameraController = cameraController;
  }

  public setTrackingMode(mode: TrackingMode): void {
    this.trackingMode = mode;
  }

  public getTrackingMode(): TrackingMode {
    return this.trackingMode;
  }

  public getFaceStatus(): DetectorStatus {
    return this.faceStatus;
  }

  public getHandStatus(): DetectorStatus {
    return this.handStatus;
  }

  public getFaceError(): string | null {
    return this.faceError;
  }

  public getHandError(): string | null {
    return this.handError;
  }

  public getLastFaceSuccessTime(): number {
    return this.lastFaceSuccessTime;
  }

  public getLastHandSuccessTime(): number {
    return this.lastHandSuccessTime;
  }

  /**
   * Initialize local MediaPipe FaceLandmarker and HandLandmarker independently
   * with bundled WASM and local .task models.
   * Only loads models required by the current trackingMode.
   */
  public async initialize(): Promise<void> {
    if (this.isInitializing) return;

    const needFace = this.trackingMode !== 'HAND_ONLY';
    const needHand = this.trackingMode !== 'HEAD_ONLY';

    if ((!needFace || this.faceLandmarker) && (!needHand || this.handLandmarker)) {
      return;
    }

    this.isInitializing = true;
    try {
      // Direct MediaPipe C++ internal logs to console.debug to avoid false-positive Chrome extension warnings
      if (typeof globalThis !== 'undefined') {
        (globalThis as any).custom_dbg = console.debug.bind(console);
      }

      let wasmPath = '/wasm';
      let faceModelAssetPath = '/models/face_landmarker.task';
      let handModelAssetPath = '/models/hand_landmarker.task';

      if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
        wasmPath = chrome.runtime.getURL('wasm');
        faceModelAssetPath = chrome.runtime.getURL('models/face_landmarker.task');
        handModelAssetPath = chrome.runtime.getURL('models/hand_landmarker.task');
      }

      console.log('[Handsfree Vision] Loading MediaPipe vision tasks from:', wasmPath, `(mode: ${this.trackingMode})`);
      const vision = await FilesetResolver.forVisionTasks(wasmPath);

      // 1. Initialize FaceLandmarker independently (if required by trackingMode)
      if (needFace && !this.faceLandmarker) {
        this.faceStatus = 'LOADING';
        try {
          this.faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: faceModelAssetPath,
              delegate: 'GPU',
            },
            runningMode: 'VIDEO',
            numFaces: 1,
            minFaceDetectionConfidence: 0.35,
            minFacePresenceConfidence: 0.35,
            minTrackingConfidence: 0.35,
          });
          this.faceStatus = 'READY';
          this.faceError = null;
          console.log('[Handsfree Vision] FaceLandmarker initialized with GPU delegate.');
        } catch (faceGpuErr) {
          try {
            console.warn('[Handsfree Vision] FaceLandmarker GPU delegate failed, falling back to CPU:', faceGpuErr);
            this.faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
              baseOptions: {
                modelAssetPath: faceModelAssetPath,
                delegate: 'CPU',
              },
              runningMode: 'VIDEO',
              numFaces: 1,
              minFaceDetectionConfidence: 0.35,
              minFacePresenceConfidence: 0.35,
              minTrackingConfidence: 0.35,
            });
            this.faceStatus = 'READY';
            this.faceError = null;
            console.log('[Handsfree Vision] FaceLandmarker initialized with CPU delegate.');
          } catch (faceErr: any) {
            console.error('[Handsfree Vision] FaceLandmarker failed to initialize:', faceErr);
            this.faceStatus = 'ERROR';
            this.faceError = faceErr?.message || String(faceErr);
          }
        }
      }

      // 2. Initialize HandLandmarker independently (if required by trackingMode)
      if (needHand && !this.handLandmarker) {
        this.handStatus = 'LOADING';
        try {
          this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: handModelAssetPath,
              delegate: 'GPU',
            },
            runningMode: 'VIDEO',
            numHands: 2,
            minHandDetectionConfidence: 0.35,
            minHandPresenceConfidence: 0.30,
            minTrackingConfidence: 0.30,
          });
          this.handStatus = 'READY';
          this.handError = null;
          console.log('[Handsfree Vision] HandLandmarker initialized with GPU delegate.');
        } catch (handGpuErr) {
          try {
            console.warn('[Handsfree Vision] HandLandmarker GPU delegate failed, falling back to CPU:', handGpuErr);
            this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
              baseOptions: {
                modelAssetPath: handModelAssetPath,
                delegate: 'CPU',
              },
              runningMode: 'VIDEO',
              numHands: 2,
              minHandDetectionConfidence: 0.35,
              minHandPresenceConfidence: 0.30,
              minTrackingConfidence: 0.30,
            });
            this.handStatus = 'READY';
            this.handError = null;
            console.log('[Handsfree Vision] HandLandmarker initialized with CPU delegate.');
          } catch (handErr: any) {
            console.error('[Handsfree Vision] HandLandmarker failed to initialize:', handErr);
            this.handStatus = 'ERROR';
            this.handError = handErr?.message || String(handErr);
          }
        }
      }

      if (needHand && !this.handLandmarker && (!needFace || !this.faceLandmarker)) {
        throw new Error(
          `Failed to initialize vision models for mode ${this.trackingMode}. Face: ${this.faceError || 'disabled'}, Hand: ${this.handError || 'failed'}`
        );
      }
    } finally {
      this.isInitializing = false;
    }
  }

  public getFaceLandmarker(): FaceLandmarker | null {
    return this.faceLandmarker;
  }

  public getHandLandmarker(): HandLandmarker | null {
    return this.handLandmarker;
  }

  public getStateMachine(): TrackingStateMachine {
    return this.stateMachine;
  }

  public getOpticalTracker(): OpticalFlowTracker {
    return this.opticalTracker;
  }

  public getGestureDetector(): HandGestureDetector {
    return this.gestureDetector;
  }

  /**
   * Start frame processing loop on an active HTMLVideoElement
   */
  public start(videoElement: HTMLVideoElement, onResult: TrackingResultCallback): void {
    this.currentVideoElement = videoElement;
    this.onResultCallback = onResult;
    this.isProcessing = true;
    this.lastVideoTime = -1;
    this.lastFrameTime = 0;

    const scheduleNextFrame = () => {
      if (!this.isProcessing) return;

      if (this.fallbackTimerId !== null) {
        clearTimeout(this.fallbackTimerId);
        this.fallbackTimerId = null;
      }

      // 45ms backup timer ensures the loop runs even in offscreen documents where rAF is suspended
      this.fallbackTimerId = setTimeout(() => {
        this.fallbackTimerId = null;
        processLoop();
      }, 45);

      if (typeof (videoElement as any).requestVideoFrameCallback === 'function') {
        this.videoCallbackId = (videoElement as any).requestVideoFrameCallback(() => {
          if (this.fallbackTimerId !== null) {
            clearTimeout(this.fallbackTimerId);
            this.fallbackTimerId = null;
          }
          processLoop();
        });
      } else if (typeof requestAnimationFrame !== 'undefined') {
        this.animationFrameId = requestAnimationFrame(() => {
          if (this.fallbackTimerId !== null) {
            clearTimeout(this.fallbackTimerId);
            this.fallbackTimerId = null;
          }
          processLoop();
        });
      }
    };

    const processLoop = () => {
      if (!this.isProcessing) return;

      const now = performance.now();
      // Throttle inference loop to ~30 FPS (minimum 28ms between frames)
      if (now - this.lastFrameTime < 28) {
        scheduleNextFrame();
        return;
      }

      if (
        videoElement.readyState >= 2 &&
        videoElement.videoWidth > 0 &&
        videoElement.videoHeight > 0 &&
        videoElement.currentTime !== this.lastVideoTime
      ) {
        this.lastVideoTime = videoElement.currentTime;
        this.lastFrameTime = now;
        const startTime = performance.now();

        let faceResult: FaceLandmarkerResult | null = null;
        let handResult: HandLandmarkerResult | null = null;

        // 1. Independent Face Detection
        if (this.faceLandmarker && this.trackingMode !== 'HAND_ONLY' && !this.isInferringFace) {
          this.isInferringFace = true;
          try {
            const faceTimestamp = Math.max(startTime, this.lastFaceDetectTime + 1);
            this.lastFaceDetectTime = faceTimestamp;
            faceResult = this.faceLandmarker.detectForVideo(videoElement, faceTimestamp);
            this.faceStatus = faceResult.faceLandmarks.length > 0 ? 'TRACKING' : 'NOT_VISIBLE';
            this.faceError = null;
          } catch (fErr: any) {
            console.warn('[Handsfree Vision] FaceLandmarker frame error:', fErr);
            this.faceError = fErr?.message || String(fErr);
            this.faceStatus = 'ERROR';
          } finally {
            this.isInferringFace = false;
          }
        }

        // 2. Independent Hand Detection
        if (this.handLandmarker && this.trackingMode !== 'HEAD_ONLY' && !this.isInferringHand) {
          this.isInferringHand = true;
          try {
            const handTimestamp = Math.max(startTime, this.lastHandDetectTime + 1);
            this.lastHandDetectTime = handTimestamp;
            handResult = this.handLandmarker.detectForVideo(videoElement, handTimestamp);
            this.handStatus = handResult.landmarks.length > 0 ? 'TRACKING' : 'NOT_VISIBLE';
            this.handError = null;
          } catch (hErr: any) {
            console.warn('[Handsfree Vision] HandLandmarker frame error:', hErr);
            this.handError = hErr?.message || String(hErr);
            this.handStatus = 'ERROR';
          } finally {
            this.isInferringHand = false;
          }
        }

        const latencyMs = performance.now() - startTime;
        if (this.cameraController) {
          this.cameraController.recordFrameProcessed(latencyMs);
        }

        this.processCombinedResults(faceResult, handResult, startTime);
      }

      scheduleNextFrame();
    };

    scheduleNextFrame();
  }

  public calculateBoundingBox(landmarks: NormalizedLandmark[]): FaceBoundingBox {
    let minX = 1;
    let minY = 1;
    let maxX = 0;
    let maxY = 0;

    for (let i = 0; i < landmarks.length; i++) {
      const p = landmarks[i];
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }

    return {
      xMin: Math.max(0, minX),
      yMin: Math.max(0, minY),
      width: Math.max(0, maxX - minX),
      height: Math.max(0, maxY - minY),
    };
  }

  /**
   * Process face landmarks into head pose coordinates.
   */
  private extractFacePose(faces: NormalizedLandmark[][], timestamp: number) {
    if (!faces || faces.length === 0) {
      return null;
    }

    const multipleFacesDetected = faces.length > 1;
    let primaryIndex = 0;
    let maxArea = -1;
    let primaryBBox: FaceBoundingBox | undefined;

    for (let i = 0; i < faces.length; i++) {
      const bbox = this.calculateBoundingBox(faces[i]);
      const area = bbox.width * bbox.height;
      if (area > maxArea) {
        maxArea = area;
        primaryIndex = i;
        primaryBBox = bbox;
      }
    }

    const landmarks = faces[primaryIndex];
    if (!landmarks || landmarks.length < 400) {
      return null;
    }

    const nose = landmarks[1];
    const leftEye = landmarks[33];
    const rightEye = landmarks[263];
    const forehead = landmarks[10];
    const chin = landmarks[152];

    if (
      !nose ||
      !leftEye ||
      !rightEye ||
      !forehead ||
      !chin ||
      !Number.isFinite(nose.x) ||
      !Number.isFinite(nose.y) ||
      !Number.isFinite(leftEye.x) ||
      !Number.isFinite(rightEye.x)
    ) {
      return null;
    }

    const eyeMidX = (leftEye.x + rightEye.x) / 2;
    const dxEye = rightEye.x - leftEye.x;
    const dyEye = rightEye.y - leftEye.y;
    const interOcularDist2D = Math.max(0.01, Math.hypot(dxEye, dyEye));
    const asymmetry2D = (nose.x - eyeMidX) / interOcularDist2D;
    const dzEye = (leftEye.z || 0) - (rightEye.z || 0);
    const dzAsymmetry = dzEye / interOcularDist2D;
    const rawYaw = -0.65 * asymmetry2D + 0.55 * dzAsymmetry;
    const yaw = Math.max(-1.0, Math.min(1.0, rawYaw * 2.5));

    const verticalSpan2D = Math.max(0.02, Math.hypot(chin.x - forehead.x, chin.y - forehead.y));
    const foreheadChinMidY = (forehead.y + chin.y) / 2;
    const asymmetryVertical2D = (nose.y - foreheadChinMidY) / verticalSpan2D;
    const dzVertical = ((chin.z || 0) - (forehead.z || 0)) / verticalSpan2D;
    const rawPitch = 0.65 * asymmetryVertical2D + 0.85 * dzVertical;
    const pitch = Math.max(-1.0, Math.min(1.0, rawPitch * 2.5));

    const transX = Math.max(-1.0, Math.min(1.0, (0.5 - nose.x) * 2.5));
    const transY = Math.max(-1.0, Math.min(1.0, (nose.y - 0.5) * 2.5));
    const normalizedX = Math.max(-1.0, Math.min(1.0, 0.7 * yaw + 0.3 * transX));
    const normalizedY = Math.max(-1.0, Math.min(1.0, 0.7 * pitch + 0.3 * transY));

    const quality: TrackingQuality = multipleFacesDetected ? 'DEGRADED' : 'OPTIMAL';
    const confidence = multipleFacesDetected ? 0.55 : 0.85;

    return {
      landmarks,
      yaw,
      pitch,
      roll: 0,
      normalizedX,
      normalizedY,
      confidence,
      quality,
      boundingBox: primaryBBox,
      multipleFacesDetected,
    };
  }

  /**
   * Process hand landmarks into detected hands and gestures.
   */
  private extractHands(
    rawHandLandmarks: NormalizedLandmark[][],
    handednessCategories: any[],
    timestamp: number
  ): DetectedHand[] {
    if (!rawHandLandmarks || rawHandLandmarks.length === 0) {
      return [];
    }

    const detectedHands: DetectedHand[] = [];
    for (let i = 0; i < rawHandLandmarks.length; i++) {
      const lms = rawHandLandmarks[i];
      if (!lms || lms.length < 21) continue;

      let handednessLabel = 'Right';
      let score = 0.95;

      if (handednessCategories[i] && handednessCategories[i][0]) {
        handednessLabel = handednessCategories[i][0].categoryName || 'Right';
        score = handednessCategories[i][0].score ?? 0.95;
      } else if (i === 1) {
        handednessLabel = 'Left';
      }

      const detected = this.gestureDetector.processHand(lms, handednessLabel, score, timestamp);
      detectedHands.push(detected);
    }

    return detectedHands;
  }

  /**
   * Primary fusion processor taking results from both detectors
   */
  public processCombinedResults(
    faceResult: FaceLandmarkerResult | { faceLandmarks: NormalizedLandmark[][] } | null,
    handResult: HandLandmarkerResult | { landmarks?: NormalizedLandmark[][]; handLandmarks?: NormalizedLandmark[][]; handedness?: any[] } | null,
    timestamp: number
  ): void {
    // 1. Extract Face Pose
    const faceLmsList = faceResult?.faceLandmarks || [];
    const facePose = this.extractFacePose(faceLmsList, timestamp);
    const faceDetected = Boolean(facePose);
    if (faceDetected) {
      this.lastFaceSuccessTime = timestamp;
      this.faceStatus = 'TRACKING';
    } else if (this.faceStatus !== 'ERROR' && this.faceStatus !== 'LOADING') {
      this.faceStatus = 'NOT_VISIBLE';
    }

    // 2. Extract Hands
    let rawHandLandmarks: NormalizedLandmark[][] = [];
    let handednessCategories: any[] = [];
    if (handResult) {
      if ('landmarks' in handResult && Array.isArray(handResult.landmarks)) {
        rawHandLandmarks = handResult.landmarks;
        handednessCategories = (handResult as any).handedness || [];
      } else if ('handLandmarks' in handResult && Array.isArray((handResult as any).handLandmarks)) {
        rawHandLandmarks = (handResult as any).handLandmarks;
        handednessCategories = (handResult as any).handedness || [];
      }
    }

    const detectedHands = this.extractHands(rawHandLandmarks, handednessCategories, timestamp);
    const handDetected = detectedHands.length > 0;
    if (handDetected) {
      this.lastHandSuccessTime = timestamp;
      this.handStatus = 'TRACKING';
    } else if (this.handStatus !== 'ERROR' && this.handStatus !== 'LOADING') {
      this.handStatus = 'NOT_VISIBLE';
    }

    // 3. Determine Active Tracking Source
    let activeSource: ActiveTrackingSource = 'NONE';
    if (this.trackingMode === 'HAND_ONLY') {
      activeSource = handDetected ? 'HAND' : 'NONE';
    } else if (this.trackingMode === 'HEAD_ONLY') {
      activeSource = faceDetected ? 'FACE' : 'NONE';
    } else {
      // HYBRID: Hand takes precedence when user points or gestures, head otherwise
      if (handDetected) {
        activeSource = 'HAND';
      } else if (faceDetected) {
        activeSource = 'FACE';
      }
    }

    // Edge Case: Neither hand nor face detected
    if (activeSource === 'NONE') {
      let opticalResult = null;
      if (this.currentVideoElement) {
        opticalResult = this.opticalTracker.track(this.currentVideoElement);
      }

      const lastTrusted = this.stateMachine.getLastTrustedResult();
      if (opticalResult && opticalResult.confidence > 0.35 && lastTrusted) {
        const transX = Math.max(-1.0, Math.min(1.0, (opticalResult.x - 0.5) * 2.0));
        const transY = Math.max(-1.0, Math.min(1.0, (opticalResult.y - 0.5) * 2.0));
        const fusedResult: TrackingResult = {
          ...lastTrusted,
          timestamp,
          faceStatus: this.faceStatus,
          handStatus: this.handStatus,
          faceError: this.faceError,
          handError: this.handError,
          lastFaceDetectionTime: this.lastFaceSuccessTime,
          lastHandDetectionTime: this.lastHandSuccessTime,
          activeSource: lastTrusted.activeSource || 'NONE',
          normalizedX: 0.7 * lastTrusted.yaw + 0.3 * transX,
          normalizedY: 0.7 * lastTrusted.pitch + 0.3 * transY,
          confidence: Math.max(0.4, lastTrusted.confidence * opticalResult.confidence),
          quality: 'DEGRADED',
          handDetected: false,
          faceDetected: false,
        };
        const stateResult = this.stateMachine.processObservation(fusedResult, timestamp);
        this.emitResult(stateResult, this.lastValidLandmarks || undefined);
        return;
      }

      const stateResult = this.stateMachine.processObservation(null, timestamp);
      const enrichedResult: TrackingResult = {
        ...stateResult,
        faceStatus: this.faceStatus,
        handStatus: this.handStatus,
        faceError: this.faceError,
        handError: this.handError,
        lastFaceDetectionTime: this.lastFaceSuccessTime,
        lastHandDetectionTime: this.lastHandSuccessTime,
        activeSource: stateResult.faceDetected ? 'FACE' : stateResult.handDetected ? 'HAND' : 'NONE',
        faceDetected: stateResult.faceDetected,
        handDetected: stateResult.handDetected,
        handsDetected: stateResult.handsDetected || 0,
        hands: stateResult.hands || [],
        activeHand: stateResult.activeHand || null,
        activeGesture: stateResult.activeGesture || 'UNKNOWN',
      };

      this.emitResult(enrichedResult, this.lastValidLandmarks || undefined);
      if (enrichedResult.trackingState === 'NO_FACE') {
        this.lastValidLandmarks = null;
        this.opticalTracker.reset();
      }
      return;
    }

    // 4. Construct Result depending on Active Source
    if (activeSource === 'HAND') {
      let primaryHand = detectedHands[0];
      if (detectedHands.length > 1) {
        const activeHand = detectedHands.find(
          (h) => h.gesture === 'PINCH' || h.gesture === 'DOUBLE_PINCH' || h.gesture === 'POINTING'
        );
        if (activeHand) {
          primaryHand = activeHand;
        } else if (detectedHands[1].score > detectedHands[0].score) {
          primaryHand = detectedHands[1];
        }
      }

      const primaryLandmarks = primaryHand.landmarks;
      const indexTip = primaryLandmarks[8] || primaryLandmarks[0];

      const normX = (primaryHand.cursorNormalizedX - 0.5) * 2.0;
      const normY = (primaryHand.cursorNormalizedY - 0.5) * 2.0;

      this.opticalTracker.setAnchor(indexTip.x, indexTip.y);

      this.recentXs.push(normX);
      this.recentYs.push(normY);
      if (this.recentXs.length > this.bufferCapacity) {
        this.recentXs.shift();
        this.recentYs.shift();
      }

      const meanX = this.recentXs.reduce((a, b) => a + b, 0) / this.recentXs.length;
      const meanY = this.recentYs.reduce((a, b) => a + b, 0) / this.recentYs.length;
      const jitter = Math.sqrt(
        this.recentXs.reduce((a, b) => a + Math.pow(b - meanX, 2), 0) / this.recentXs.length +
          this.recentYs.reduce((a, b) => a + Math.pow(b - meanY, 2), 0) / this.recentYs.length
      );

      let confidence = primaryHand.score;
      if (jitter > 0.15) {
        confidence = Math.max(0.4, confidence * 0.85);
      }

      let quality: TrackingQuality = 'OPTIMAL';
      if (confidence < 0.4) {
        quality = 'INSUFFICIENT';
      } else if (confidence < 0.65 || jitter > 0.2) {
        quality = 'DEGRADED';
      }

      const primaryBBox: FaceBoundingBox = {
        xMin: primaryHand.boundingBox.xMin,
        yMin: primaryHand.boundingBox.yMin,
        width: primaryHand.boundingBox.width,
        height: primaryHand.boundingBox.height,
      };

      const rawTrackingResult: TrackingResult = {
        timestamp,
        faceStatus: this.faceStatus,
        handStatus: this.handStatus,
        faceError: this.faceError,
        handError: this.handError,
        lastFaceDetectionTime: this.lastFaceSuccessTime,
        lastHandDetectionTime: this.lastHandSuccessTime,
        activeSource: 'HAND',
        normalizedX: normX,
        normalizedY: normY,
        cursorNormalizedX: primaryHand.cursorNormalizedX,
        cursorNormalizedY: primaryHand.cursorNormalizedY,
        yaw: normX,
        pitch: normY,
        roll: 0,
        confidence: Math.round(confidence * 100) / 100,
        quality,
        faceDetected,
        handDetected: true,
        handsDetected: detectedHands.length,
        hands: detectedHands,
        activeHand: primaryHand,
        activeGesture: primaryHand.gesture,
        multipleFacesDetected: detectedHands.length > 1,
        landmarksCount: primaryLandmarks.length,
        boundingBox: primaryBBox,
        faceLandmarks: facePose?.landmarks,
      };

      const finalResult = this.stateMachine.processObservation(rawTrackingResult, timestamp);
      this.lastValidLandmarks = primaryLandmarks as any;
      this.emitResult(finalResult, primaryLandmarks as any);
      return;
    }

    // Active source is FACE
    if (activeSource === 'FACE' && facePose) {
      const rawTrackingResult: TrackingResult = {
        timestamp,
        faceStatus: this.faceStatus,
        handStatus: this.handStatus,
        faceError: this.faceError,
        handError: this.handError,
        lastFaceDetectionTime: this.lastFaceSuccessTime,
        lastHandDetectionTime: this.lastHandSuccessTime,
        activeSource: 'FACE',
        normalizedX: facePose.normalizedX,
        normalizedY: facePose.normalizedY,
        cursorNormalizedX: 0.5 + facePose.normalizedX * 0.5,
        cursorNormalizedY: 0.5 + facePose.normalizedY * 0.5,
        yaw: facePose.yaw,
        pitch: facePose.pitch,
        roll: facePose.roll,
        confidence: facePose.confidence,
        quality: facePose.quality,
        faceDetected: true,
        handDetected: false,
        handsDetected: 0,
        hands: [],
        activeHand: null,
        activeGesture: 'UNKNOWN',
        multipleFacesDetected: facePose.multipleFacesDetected,
        landmarksCount: facePose.landmarks.length,
        faceLandmarks: facePose.landmarks,
        boundingBox: facePose.boundingBox,
      };

      const finalResult = this.stateMachine.processObservation(rawTrackingResult, timestamp);
      this.lastValidLandmarks = facePose.landmarks;
      this.emitResult(finalResult, facePose.landmarks);
    }
  }

  /**
   * Backward-compatible delegation for mock tests and single-result calls
   */
  public processLandmarkerResult(result: any, timestamp: number): void {
    if (result.faceLandmarks) {
      this.processCombinedResults({ faceLandmarks: result.faceLandmarks }, null, timestamp);
      return;
    }

    this.processCombinedResults(null, result, timestamp);
  }

  private emitResult(result: TrackingResult, landmarks?: NormalizedLandmark[]): void {
    if (this.onResultCallback) {
      this.onResultCallback(result, landmarks);
    }
  }

  public stop(): void {
    this.isProcessing = false;
    if (this.fallbackTimerId !== null) {
      clearTimeout(this.fallbackTimerId);
      this.fallbackTimerId = null;
    }
    if (this.animationFrameId !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    if (
      this.videoCallbackId !== null &&
      this.currentVideoElement &&
      typeof (this.currentVideoElement as any).cancelVideoFrameCallback === 'function'
    ) {
      (this.currentVideoElement as any).cancelVideoFrameCallback(this.videoCallbackId);
      this.videoCallbackId = null;
    }
    this.recentXs = [];
    this.recentYs = [];
    this.stateMachine.reset();
    this.opticalTracker.reset();
    this.currentVideoElement = null;
    this.lastValidLandmarks = null;
  }

  public dispose(): void {
    this.stop();
    if (this.faceLandmarker) {
      this.faceLandmarker.close();
      this.faceLandmarker = null;
    }
    if (this.handLandmarker) {
      this.handLandmarker.close();
      this.handLandmarker = null;
    }
    this.onResultCallback = null;
    this.cameraController = null;
  }
}
