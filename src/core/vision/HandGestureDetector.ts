import { HandGesture, Handedness, DetectedHand, HandLandmark } from '../../types/vision';

export interface GestureDetectionResult {
  gesture: HandGesture;
  isPinching: boolean;
  pinchDistance: number;
  isDoublePinch: boolean;
  fingerStates: {
    thumb: boolean;
    index: boolean;
    middle: boolean;
    ring: boolean;
    pinky: boolean;
  };
}

export class HandGestureDetector {
  private lastPinchReleaseTime: number = 0;
  private lastPinchState: boolean = false;
  private doublePinchWindowMs: number = 380;

  /**
   * Calculate 3D Euclidean distance between two landmarks
   */
  public static distance3D(a: HandLandmark, b: HandLandmark): number {
    return Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));
  }

  /**
   * Calculate 2D Euclidean distance between two landmarks
   */
  public static distance2D(a: HandLandmark, b: HandLandmark): number {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  /**
   * Detect gestures and finger states from 21 MediaPipe hand landmarks
   */
  public detect(landmarks: HandLandmark[], _handedness: Handedness = 'Right', now: number = Date.now()): GestureDetectionResult {
    if (!landmarks || landmarks.length < 21) {
      return {
        gesture: 'UNKNOWN',
        isPinching: false,
        pinchDistance: 1.0,
        isDoublePinch: false,
        fingerStates: { thumb: false, index: false, middle: false, ring: false, pinky: false },
      };
    }

    const wrist = landmarks[0];
    const thumbTip = landmarks[4];
    const thumbMcp = landmarks[2];
    const indexTip = landmarks[8];
    const indexPip = landmarks[6];
    const indexMcp = landmarks[5];
    const middleTip = landmarks[12];
    const middlePip = landmarks[10];
    const middleMcp = landmarks[9];
    const ringTip = landmarks[16];
    const ringPip = landmarks[14];
    const pinkyTip = landmarks[20];
    const pinkyPip = landmarks[18];

    // Reference hand scale: Wrist (0) to Middle MCP (9)
    const handScale = Math.max(0.01, HandGestureDetector.distance2D(wrist, middleMcp));

    // Determine finger extensions
    const isIndexExtended =
      HandGestureDetector.distance2D(indexTip, wrist) >
      HandGestureDetector.distance2D(indexPip, wrist) * 1.08;

    const isMiddleExtended =
      HandGestureDetector.distance2D(middleTip, wrist) >
      HandGestureDetector.distance2D(middlePip, wrist) * 1.08;

    const isRingExtended =
      HandGestureDetector.distance2D(ringTip, wrist) >
      HandGestureDetector.distance2D(ringPip, wrist) * 1.08;

    const isPinkyExtended =
      HandGestureDetector.distance2D(pinkyTip, wrist) >
      HandGestureDetector.distance2D(pinkyPip, wrist) * 1.08;

    // Thumb extension relative to index MCP
    const thumbDistToIndexMcp = HandGestureDetector.distance2D(thumbTip, indexMcp);
    const isThumbExtended = thumbDistToIndexMcp > handScale * 0.45;

    // Pinch detection: Thumb Tip (4) to Index Tip (8)
    const rawPinchDist = HandGestureDetector.distance2D(thumbTip, indexTip);
    const normalizedPinchDist = rawPinchDist / handScale;

    // Hysteresis threshold: enter pinch at 0.32, release at 0.42
    const isPinching = this.lastPinchState
      ? normalizedPinchDist < 0.42
      : normalizedPinchDist < 0.32;

    // Double pinch detection
    let isDoublePinch = false;
    if (isPinching && !this.lastPinchState) {
      // Pinch started
      if (now - this.lastPinchReleaseTime < this.doublePinchWindowMs && this.lastPinchReleaseTime > 0) {
        isDoublePinch = true;
        this.lastPinchReleaseTime = 0; // consume
      }
    } else if (!isPinching && this.lastPinchState) {
      // Pinch released
      this.lastPinchReleaseTime = now;
    }
    this.lastPinchState = isPinching;

    const allFourCurled = !isIndexExtended && !isMiddleExtended && !isRingExtended && !isPinkyExtended;

    let gesture: HandGesture = 'UNKNOWN';

    // 1. Clenched Fist & Thumbs Gestures (when all 4 fingers are curled into the palm)
    if (allFourCurled) {
      if (isThumbExtended) {
        const dy = thumbTip.y - thumbMcp.y;
        if (dy < -handScale * 0.25) {
          gesture = 'THUMBS_UP';
        } else if (dy > handScale * 0.25) {
          gesture = 'THUMBS_DOWN';
        } else {
          gesture = 'CLOSED_FIST';
        }
      } else {
        gesture = 'CLOSED_FIST';
      }
    }
    // 2. Pinch has top precedence for clicking (requires index finger active)
    else if (isDoublePinch) {
      gesture = 'DOUBLE_PINCH';
    } else if (isPinching) {
      gesture = 'PINCH';
    }
    // 4. Three Fingers Raised (Show interactive labels)
    else if (isIndexExtended && isMiddleExtended && isRingExtended && !isPinkyExtended) {
      gesture = 'THREE_FINGERS';
    }
    // 5. Two Fingers Raised (Scroll Mode)
    else if (isIndexExtended && isMiddleExtended && !isRingExtended && !isPinkyExtended) {
      gesture = 'TWO_FINGERS';
    }
    // 6. Open Palm (Hover / Pause / Neutral)
    else if (isIndexExtended && isMiddleExtended && isRingExtended && isPinkyExtended && isThumbExtended) {
      gesture = 'OPEN_PALM';
    }
    // 7. Pointing Finger (Cursor movement)
    else if (isIndexExtended) {
      gesture = 'POINTING';
    } else {
      gesture = 'UNKNOWN';
    }

    return {
      gesture,
      isPinching,
      pinchDistance: normalizedPinchDist,
      isDoublePinch,
      fingerStates: {
        thumb: isThumbExtended,
        index: isIndexExtended,
        middle: isMiddleExtended,
        ring: isRingExtended,
        pinky: isPinkyExtended,
      },
    };
  }

  /**
   * Convert MediaPipe raw landmarks and handedness into a DetectedHand object
   */
  public processHand(
    rawLandmarks: { x: number; y: number; z?: number }[],
    handednessLabel: string,
    score: number = 0.9,
    now: number = Date.now()
  ): DetectedHand {
    const landmarks: HandLandmark[] = rawLandmarks.map((lm) => ({
      x: lm.x,
      y: lm.y,
      z: lm.z ?? 0,
    }));

    // In mirrored webcam video:
    // When MediaPipe returns 'Left', it's the user's physical Right hand (due to mirroring),
    // but we can normalize handedness for intuitive user display.
    const handedness: Handedness = handednessLabel.toLowerCase().includes('left') ? 'Left' : 'Right';

    const detection = this.detect(landmarks, handedness, now);

    // Calculate bounding box
    const xs = landmarks.map((l) => l.x);
    const ys = landmarks.map((l) => l.y);
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs);
    const yMin = Math.min(...ys);
    const yMax = Math.max(...ys);

    // Mirrored cursor position: Index finger tip (8) gives pointer position
    const indexTip = landmarks[8] || landmarks[0];
    const cursorNormalizedX = Math.max(0, Math.min(1, 1.0 - indexTip.x)); // Mirrored
    const cursorNormalizedY = Math.max(0, Math.min(1, indexTip.y));

    return {
      handedness,
      score,
      landmarks,
      gesture: detection.gesture,
      pinchDistance: detection.pinchDistance,
      isPinching: detection.isPinching,
      cursorNormalizedX,
      cursorNormalizedY,
      boundingBox: {
        xMin,
        yMin,
        width: xMax - xMin,
        height: yMax - yMin,
      },
    };
  }
}
