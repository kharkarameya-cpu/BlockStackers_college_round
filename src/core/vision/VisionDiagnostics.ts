import { DrawingUtils, HandLandmarker, NormalizedLandmark } from '@mediapipe/tasks-vision';
import { TrackingResult } from '../../types/vision';

export interface DiagnosticRenderOptions {
  showMesh: boolean;
  showContours: boolean;
  showIris: boolean;
  showPoseTriad: boolean;
  showBoundingBox: boolean;
}

export class VisionDiagnostics {
  private drawingUtils: DrawingUtils | null = null;
  private ctx: CanvasRenderingContext2D | null = null;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d');
    if (this.ctx) {
      this.drawingUtils = new DrawingUtils(this.ctx);
    }
  }

  public render(
    video: HTMLVideoElement,
    landmarks: NormalizedLandmark[] | undefined,
    result: TrackingResult,
    options: DiagnosticRenderOptions
  ): void {
    if (!this.ctx || !this.drawingUtils) return;

    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;

    // Clear canvas
    ctx.clearRect(0, 0, w, h);

    // Draw video frame mirrored
    ctx.save();
    ctx.scale(-1, 1);
    ctx.drawImage(video, -w, 0, w, h);
    ctx.restore();

    if ((!result.handDetected && !result.faceDetected) || (!landmarks && (!result.hands || result.hands.length === 0))) {
      this.renderLostOverlay(ctx, w, h, result);
      return;
    }

    // Render Hands (supports both hands!)
    if (result.hands && result.hands.length > 0) {
      result.hands.forEach((hand, idx) => {
        const mirroredHandLandmarks: NormalizedLandmark[] = hand.landmarks.map((lm) => ({
          x: 1.0 - lm.x, // mirror horizontally
          y: lm.y,
          z: lm.z ?? 0,
          visibility: 1.0,
        }));

        // Draw hand skeleton connectors
        if (options.showMesh || options.showContours) {
          const color = hand.isPinching
            ? 'rgba(16, 185, 129, 0.9)'
            : hand.gesture === 'CLOSED_FIST'
            ? 'rgba(239, 68, 68, 0.9)'
            : idx === 0
            ? 'rgba(6, 182, 212, 0.8)'
            : 'rgba(168, 85, 247, 0.8)';

          this.drawingUtils!.drawConnectors(
            mirroredHandLandmarks,
            HandLandmarker.HAND_CONNECTIONS,
            { color, lineWidth: 2.5 }
          );
          this.drawingUtils!.drawLandmarks(
            mirroredHandLandmarks,
            { color: '#ffffff', fillColor: color, radius: 3 }
          );
        }

        // Draw gesture label badge above hand
        const wrist = mirroredHandLandmarks[0];
        if (wrist) {
          const badgeX = wrist.x * w;
          const badgeY = Math.max(25, wrist.y * h - 35);
          ctx.save();
          ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
          ctx.strokeStyle = hand.isPinching ? '#10b981' : '#38bdf8';
          ctx.lineWidth = 1.5;
          const text = `${hand.handedness} Hand: ${hand.gesture}`;
          ctx.font = '600 12px Inter, sans-serif';
          const textWidth = ctx.measureText(text).width;
          ctx.beginPath();
          ctx.roundRect(badgeX - textWidth / 2 - 8, badgeY - 14, textWidth + 16, 24, 6);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = '#ffffff';
          ctx.fillText(text, badgeX - textWidth / 2, badgeY + 2);
          ctx.restore();
        }
      });
    } else if (landmarks && landmarks.length > 0) {
      // Fallback rendering
      const mirroredLandmarks: NormalizedLandmark[] = landmarks.map((lm) => ({
        ...lm,
        x: 1.0 - lm.x,
      }));
      this.drawingUtils.drawConnectors(
        mirroredLandmarks,
        HandLandmarker.HAND_CONNECTIONS,
        { color: 'rgba(56, 189, 248, 0.8)', lineWidth: 2 }
      );
    }

    // 4. Draw Bounding Box
    if (options.showBoundingBox && result.boundingBox) {
      const bbox = result.boundingBox;
      const mirroredX = (1.0 - (bbox.xMin + bbox.width)) * w;
      const bY = bbox.yMin * h;
      const bW = bbox.width * w;
      const bH = bbox.height * h;

      const qualityColors: Record<string, string> = {
        OPTIMAL: '#10b981',
        DEGRADED: '#f59e0b',
        INSUFFICIENT: '#f43f5e',
        LOST: '#ef4444',
      };
      const strokeColor = qualityColors[result.quality] || '#10b981';

      ctx.save();
      ctx.strokeStyle = strokeColor;
      ctx.lineWidth = 2;
      ctx.strokeRect(mirroredX, bY, bW, bH);

      // Quality badge
      ctx.fillStyle = strokeColor;
      ctx.font = 'bold 11px sans-serif';
      ctx.fillText(` ${result.quality} (${Math.round(result.confidence * 100)}%)`, mirroredX + 4, bY + 14);
      ctx.restore();
    }

    // 5. Draw Pointer Direction / Vector from Active Hand Pointer
    if (options.showPoseTriad && result.activeHand) {
      const indexTip = result.activeHand.landmarks[8];
      if (indexTip) {
        const nx = (1.0 - indexTip.x) * w;
        const ny = indexTip.y * h;
        const axisLen = 60;

        ctx.save();
        ctx.lineCap = 'round';

        // Index center point
        ctx.beginPath();
        ctx.arc(nx, ny, 4, 0, 2 * Math.PI);
        ctx.fillStyle = '#f59e0b';
        ctx.fill();

        // Horizontal pointer axis
        ctx.beginPath();
        ctx.moveTo(nx, ny);
        ctx.lineTo(nx + result.yaw * axisLen, ny);
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 3;
        ctx.stroke();

        // Vertical pointer axis
        ctx.beginPath();
        ctx.moveTo(nx, ny);
        ctx.lineTo(nx, ny + result.pitch * axisLen);
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 3;
        ctx.stroke();

        // Combined pointer vector
        ctx.beginPath();
        ctx.moveTo(nx, ny);
        ctx.lineTo(nx + result.yaw * axisLen, ny + result.pitch * axisLen);
        ctx.strokeStyle = '#06b6d4';
        ctx.lineWidth = 4;
        ctx.stroke();
        ctx.restore();
      }
    }
  }

  private renderLostOverlay(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    result: TrackingResult
  ): void {
    ctx.save();
    ctx.fillStyle = 'rgba(15, 23, 42, 0.4)';
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = '#ef4444';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';

    let title = 'NO TARGET VISIBLE';
    let subtitle = 'Position your face or hand clearly in the camera frame';

    if (result.faceStatus === 'ERROR' || result.handStatus === 'ERROR') {
      title = 'VISION INFERENCE ERROR';
      subtitle = result.faceError || result.handError || 'Check diagnostic metrics';
    } else if (result.faceStatus === 'LOADING' || result.handStatus === 'LOADING') {
      title = 'MODELS LOADING...';
      subtitle = 'Initializing local vision tasks...';
    }

    ctx.fillText(title, w / 2, h / 2 - 10);

    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(subtitle, w / 2, h / 2 + 14);
    ctx.restore();
  }
}

