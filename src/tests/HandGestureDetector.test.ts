import { describe, it, expect } from 'vitest';
import { HandGestureDetector } from '../core/vision/HandGestureDetector';
import { HandLandmark } from '../types/vision';

describe('HandGestureDetector Subsystem', () => {
  const detector = new HandGestureDetector();

  // Helper to generate 21 mock hand landmarks
  function createHandLandmarks(options: {
    isIndexExtended?: boolean;
    isMiddleExtended?: boolean;
    isRingExtended?: boolean;
    isPinkyExtended?: boolean;
    isThumbExtended?: boolean;
    isPinching?: boolean;
    isThumbsUp?: boolean;
    isThumbsDown?: boolean;
  } = {}): HandLandmark[] {
    const lms: HandLandmark[] = [];
    const wrist: HandLandmark = { x: 0.5, y: 0.8, z: 0 }; // Wrist at bottom
    lms.push(wrist); // 0: WRIST

    // Scale reference: Middle MCP at y = 0.55
    const middleMcp: HandLandmark = { x: 0.5, y: 0.55, z: 0 }; // 9: Middle MCP

    // 1-4: Thumb
    lms.push({ x: 0.45, y: 0.75, z: 0 }); // 1: Thumb CMC
    lms.push({ x: 0.42, y: 0.70, z: 0 }); // 2: Thumb MCP
    lms.push({ x: 0.40, y: 0.65, z: 0 }); // 3: Thumb IP

    if (options.isThumbsUp) {
      lms.push({ x: 0.40, y: 0.40, z: 0 }); // 4: Thumb TIP pointing high UP
    } else if (options.isThumbsDown) {
      lms.push({ x: 0.40, y: 0.85, z: 0 }); // 4: Thumb TIP pointing DOWN
    } else if (options.isPinching) {
      lms.push({ x: 0.48, y: 0.36, z: 0 }); // 4: Thumb TIP touching index tip
    } else if (options.isThumbExtended) {
      lms.push({ x: 0.30, y: 0.60, z: 0 }); // 4: Thumb TIP extended out
    } else {
      lms.push({ x: 0.45, y: 0.68, z: 0 }); // 4: Thumb TIP curled in
    }

    // 5-8: Index finger
    lms.push({ x: 0.46, y: 0.55, z: 0 }); // 5: Index MCP
    lms.push({ x: 0.46, y: 0.45, z: 0 }); // 6: Index PIP
    lms.push({ x: 0.46, y: 0.40, z: 0 }); // 7: Index DIP
    if (options.isIndexExtended || options.isPinching) {
      lms.push({ x: 0.48, y: 0.35, z: 0 }); // 8: Index TIP extended
    } else {
      lms.push({ x: 0.46, y: 0.60, z: 0 }); // 8: Index TIP curled in
    }

    // 9-12: Middle finger
    lms.push(middleMcp); // 9: Middle MCP
    lms.push({ x: 0.50, y: 0.45, z: 0 }); // 10: Middle PIP
    lms.push({ x: 0.50, y: 0.40, z: 0 }); // 11: Middle DIP
    if (options.isMiddleExtended) {
      lms.push({ x: 0.50, y: 0.34, z: 0 }); // 12: Middle TIP extended
    } else {
      lms.push({ x: 0.50, y: 0.60, z: 0 }); // 12: Middle TIP curled in
    }

    // 13-16: Ring finger
    lms.push({ x: 0.54, y: 0.56, z: 0 }); // 13: Ring MCP
    lms.push({ x: 0.54, y: 0.46, z: 0 }); // 14: Ring PIP
    lms.push({ x: 0.54, y: 0.41, z: 0 }); // 15: Ring DIP
    if (options.isRingExtended) {
      lms.push({ x: 0.54, y: 0.35, z: 0 }); // 16: Ring TIP extended
    } else {
      lms.push({ x: 0.54, y: 0.60, z: 0 }); // 16: Ring TIP curled in
    }

    // 17-20: Pinky finger
    lms.push({ x: 0.58, y: 0.58, z: 0 }); // 17: Pinky MCP
    lms.push({ x: 0.58, y: 0.48, z: 0 }); // 18: Pinky PIP
    lms.push({ x: 0.58, y: 0.43, z: 0 }); // 19: Pinky DIP
    if (options.isPinkyExtended) {
      lms.push({ x: 0.58, y: 0.38, z: 0 }); // 20: Pinky TIP extended
    } else {
      lms.push({ x: 0.58, y: 0.62, z: 0 }); // 20: Pinky TIP curled in
    }

    return lms;
  }

  it('detects Index Finger Pointing for cursor control', () => {
    const lms = createHandLandmarks({ isIndexExtended: true });
    const result = detector.detect(lms);
    expect(result.gesture).toBe('POINTING');
    expect(result.isPinching).toBe(false);
  });

  it('detects Thumb-Index Pinch for clicking', () => {
    const lms = createHandLandmarks({ isPinching: true });
    const result = detector.detect(lms);
    expect(result.isPinching).toBe(true);
    expect(result.gesture).toBe('PINCH');
  });

  it('detects Closed Fist to freeze cursor motion', () => {
    const lms = createHandLandmarks({
      isIndexExtended: false,
      isMiddleExtended: false,
      isRingExtended: false,
      isPinkyExtended: false,
      isThumbExtended: false,
    });
    const result = detector.detect(lms);
    expect(result.gesture).toBe('CLOSED_FIST');
  });

  it('detects Two Fingers Raised for page scrolling mode', () => {
    const lms = createHandLandmarks({
      isIndexExtended: true,
      isMiddleExtended: true,
      isRingExtended: false,
      isPinkyExtended: false,
    });
    const result = detector.detect(lms);
    expect(result.gesture).toBe('TWO_FINGERS');
  });

  it('detects Three Fingers Raised to show interactive target labels', () => {
    const lms = createHandLandmarks({
      isIndexExtended: true,
      isMiddleExtended: true,
      isRingExtended: true,
      isPinkyExtended: false,
    });
    const result = detector.detect(lms);
    expect(result.gesture).toBe('THREE_FINGERS');
  });

  it('detects Thumbs Up for action confirmation', () => {
    const lms = createHandLandmarks({
      isThumbsUp: true,
      isIndexExtended: false,
      isMiddleExtended: false,
      isRingExtended: false,
      isPinkyExtended: false,
    });
    const result = detector.detect(lms);
    expect(result.gesture).toBe('THUMBS_UP');
  });

  it('processes dual hands and accurately mirrors screen coordinates', () => {
    const lms = createHandLandmarks({ isIndexExtended: true });
    const hand = detector.processHand(lms, 'Right', 0.98);
    expect(hand.handedness).toBe('Right');
    expect(hand.gesture).toBe('POINTING');
    // Screen X must be mirrored: 1.0 - 0.48 = 0.52
    expect(hand.cursorNormalizedX).toBeCloseTo(0.52, 1);
  });
});
