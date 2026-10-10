import { describe, it, expect } from 'vitest';
import { VisionProcessor } from '../core/vision/VisionProcessor';
import { TrackingResult } from '../types/vision';
import { NormalizedLandmark } from '@mediapipe/tasks-vision';

describe('VisionProcessor Landmark Parsing & Quality Logic', () => {
  // Helper to create mock face landmarks
  function createMockFace(noseX = 0.5, noseY = 0.5, eyeSpan = 0.2): NormalizedLandmark[] {
    const landmarks: NormalizedLandmark[] = [];
    for (let i = 0; i < 478; i++) {
      landmarks.push({ x: 0.5, y: 0.5, z: 0, visibility: 0.9 });
    }

    // Set key canonical landmarks
    // 1: Nose tip
    landmarks[1] = { x: noseX, y: noseY, z: 0, visibility: 0.95 };
    // 33: Left eye outer
    landmarks[33] = { x: 0.5 - eyeSpan / 2, y: 0.45, z: 0, visibility: 0.95 };
    // 263: Right eye outer
    landmarks[263] = { x: 0.5 + eyeSpan / 2, y: 0.45, z: 0, visibility: 0.95 };
    // 10: Forehead top
    landmarks[10] = { x: 0.5, y: 0.25, z: 0, visibility: 0.95 };
    // 152: Chin bottom
    landmarks[152] = { x: 0.5, y: 0.75, z: 0, visibility: 0.95 };

    return landmarks;
  }

  it('should emit quality: LOST when no faces are detected', () => {
    const processor = new VisionProcessor();
    let result: TrackingResult | null = null;

    // Direct invocation of the internal processing logic
    (processor as any).onResultCallback = (res: TrackingResult) => {
      result = res;
    };

    (processor as any).processLandmarkerResult({ faceLandmarks: [] }, 1000);

    expect(result).not.toBeNull();
    expect(result!.faceDetected).toBe(false);
    expect(result!.quality).toBe('LOST');
    expect(result!.confidence).toBe(0);
    expect(result!.normalizedX).toBe(0);
    expect(result!.normalizedY).toBe(0);
  });

  it('should calculate neutral pose centered at (0, 0)', () => {
    const processor = new VisionProcessor();
    let result: TrackingResult | null = null;

    (processor as any).onResultCallback = (res: TrackingResult) => {
      result = res;
    };

    const face = createMockFace(0.5, 0.5, 0.2);
    (processor as any).processLandmarkerResult({ faceLandmarks: [face] }, 1000);

    expect(result).not.toBeNull();
    expect(result!.faceDetected).toBe(true);
    expect(result!.quality).toBe('OPTIMAL');
    expect(result!.confidence).toBeGreaterThan(0.6);
    expect(Math.abs(result!.normalizedX)).toBeLessThan(0.05);
    expect(Math.abs(result!.normalizedY)).toBeLessThan(0.05);
  });

  it('should correctly reflect positive yaw when looking right', () => {
    const processor = new VisionProcessor();
    let result: TrackingResult | null = null;

    (processor as any).onResultCallback = (res: TrackingResult) => {
      result = res;
    };

    // Nose shifted left on camera sensor (which corresponds to user turning right)
    const faceTurnRight = createMockFace(0.44, 0.5, 0.2);
    (processor as any).processLandmarkerResult({ faceLandmarks: [faceTurnRight] }, 1000);

    expect(result).not.toBeNull();
    // NormalizedX should be positive for turning right (screen coordinate mapping)
    expect(result!.normalizedX).toBeGreaterThan(0.2);
  });

  it('should detect multiple faces and degrade quality to DEGRADED', () => {
    const processor = new VisionProcessor();
    let result: TrackingResult | null = null;

    (processor as any).onResultCallback = (res: TrackingResult) => {
      result = res;
    };

    const face1 = createMockFace(0.5, 0.5, 0.2);
    const face2 = createMockFace(0.8, 0.5, 0.1);

    (processor as any).processLandmarkerResult({ faceLandmarks: [face1, face2] }, 1000);

    expect(result).not.toBeNull();
    expect(result!.multipleFacesDetected).toBe(true);
    expect(result!.quality).toBe('DEGRADED');
  });

  it('should calculate accurate face bounding box coordinates', () => {
    const processor = new VisionProcessor();
    const face = createMockFace(0.5, 0.5, 0.2);

    const bbox = (processor as any).calculateBoundingBox(face);
    expect(bbox.xMin).toBeGreaterThanOrEqual(0);
    expect(bbox.xMin).toBeLessThan(0.5);
    expect(bbox.width).toBeGreaterThan(0);
    expect(bbox.height).toBeGreaterThan(0);
  });

  it('should accurately calculate 3D yaw across horizontal XYZ rotation', () => {
    const processor = new VisionProcessor();
    let result: TrackingResult | null = null;
    (processor as any).onResultCallback = (res: TrackingResult) => {
      result = res;
    };

    // 3D face turned right: left eye/temple closer to camera (z = -0.05), right eye/temple further (z = +0.05)
    const face3DRight = createMockFace(0.5, 0.5, 0.2);
    face3DRight[33].z = 0.05;
    face3DRight[234].z = 0.05;
    face3DRight[263].z = -0.05;
    face3DRight[454].z = -0.05;

    (processor as any).processLandmarkerResult({ faceLandmarks: [face3DRight] }, 1000);
    expect(result).not.toBeNull();
    expect(result!.yaw).toBeGreaterThan(0.2);
    expect(result!.normalizedX).toBeGreaterThan(0.2);

    // 3D face turned left: right eye/temple closer to camera (z = -0.05), left eye/temple further (z = +0.05)
    const face3DLeft = createMockFace(0.5, 0.5, 0.2);
    face3DLeft[33].z = -0.05;
    face3DLeft[234].z = -0.05;
    face3DLeft[263].z = 0.05;
    face3DLeft[454].z = 0.05;

    (processor as any).processLandmarkerResult({ faceLandmarks: [face3DLeft] }, 1001);
    expect(result!.yaw).toBeLessThan(-0.2);
    expect(result!.normalizedX).toBeLessThan(-0.2);
  });

  it('should accurately calculate 3D pitch across vertical XYZ rotation', () => {
    const processor = new VisionProcessor();
    let result: TrackingResult | null = null;
    (processor as any).onResultCallback = (res: TrackingResult) => {
      result = res;
    };

    // 3D face tilting UP: forehead tilts back (z = +0.06), chin tilts forward (z = -0.06)
    const faceTiltUp = createMockFace(0.5, 0.5, 0.2);
    faceTiltUp[10].z = 0.06;
    faceTiltUp[168].z = 0.04;
    faceTiltUp[152].z = -0.06;

    (processor as any).processLandmarkerResult({ faceLandmarks: [faceTiltUp] }, 1000);
    expect(result).not.toBeNull();
    // Negative pitch = looking up (towards top of screen)
    expect(result!.pitch).toBeLessThan(-0.2);
    expect(result!.normalizedY).toBeLessThan(-0.2);

    // 3D face tilting DOWN: forehead tilts forward (z = -0.06), chin tilts back (z = +0.06)
    const faceTiltDown = createMockFace(0.5, 0.5, 0.2);
    faceTiltDown[10].z = -0.06;
    faceTiltDown[168].z = -0.04;
    faceTiltDown[152].z = 0.06;

    (processor as any).processLandmarkerResult({ faceLandmarks: [faceTiltDown] }, 1001);
    // Positive pitch = looking down (towards bottom of screen)
    expect(result!.pitch).toBeGreaterThan(0.2);
    expect(result!.normalizedY).toBeGreaterThan(0.2);
  });

  it('should bridge momentary face occlusion using the 5-frame grace buffer', () => {
    const processor = new VisionProcessor();
    let result: TrackingResult | null = null;
    (processor as any).onResultCallback = (res: TrackingResult) => {
      result = res;
    };

    const validFace = createMockFace(0.5, 0.5, 0.2);
    (processor as any).processLandmarkerResult({ faceLandmarks: [validFace] }, 1000);
    expect(result!.faceDetected).toBe(true);

    // Frame 2: Momentary occlusion (0 faces) -> should be kept via grace buffer
    (processor as any).processLandmarkerResult({ faceLandmarks: [] }, 1033);
    expect(result!.faceDetected).toBe(true);
    expect(result!.quality).toBe('DEGRADED');

    // Frames 3, 4, 5: Still within grace buffer
    (processor as any).processLandmarkerResult({ faceLandmarks: [] }, 1066);
    expect(result!.faceDetected).toBe(true);

    // After 6 consecutive empty frames: Declared LOST
    for (let i = 0; i < 4; i++) {
      (processor as any).processLandmarkerResult({ faceLandmarks: [] }, 1100 + i * 33);
    }
    expect(result!.faceDetected).toBe(false);
    expect(result!.quality).toBe('LOST');
  });

  it('should reliably maintain tracking during three-quarter side-facing head turns', () => {
    const processor = new VisionProcessor();
    let result: TrackingResult | null = null;
    (processor as any).onResultCallback = (res: TrackingResult) => {
      result = res;
    };

    // Simulate 3/4 rightward head turn:
    // Left side of face is turned towards camera, right side foreshortened
    const profileFaceRight = createMockFace(0.42, 0.5, 0.16);
    // Temple / ear anchors reflect rotational perspective
    profileFaceRight[234] = { x: 0.38, y: 0.46, z: 0.08, visibility: 0.95 }; // Right temple turned away
    profileFaceRight[454] = { x: 0.58, y: 0.46, z: -0.08, visibility: 0.95 }; // Left temple turned closer

    (processor as any).processLandmarkerResult({ faceLandmarks: [profileFaceRight] }, 1000);

    expect(result).not.toBeNull();
    expect(result!.faceDetected).toBe(true);
    expect(result!.trackingState).toBe('TRACKING');
    // Substantial positive yaw mapping to rightward navigation
    expect(result!.yaw).toBeGreaterThan(0.35);
    expect(result!.normalizedX).toBeGreaterThan(0.35);

    // Simulate 3/4 leftward head turn:
    const profileFaceLeft = createMockFace(0.58, 0.5, 0.16);
    profileFaceLeft[234] = { x: 0.42, y: 0.46, z: -0.08, visibility: 0.95 };
    profileFaceLeft[454] = { x: 0.62, y: 0.46, z: 0.08, visibility: 0.95 };

    (processor as any).processLandmarkerResult({ faceLandmarks: [profileFaceLeft] }, 1033);

    expect(result!.faceDetected).toBe(true);
    expect(result!.trackingState).toBe('TRACKING');
    // Substantial negative yaw mapping to leftward navigation
    expect(result!.yaw).toBeLessThan(-0.35);
    expect(result!.normalizedX).toBeLessThan(-0.35);
  });

  it('should safely reject non-finite corrupted landmark observations', () => {
    const processor = new VisionProcessor();
    let result: TrackingResult | null = null;
    (processor as any).onResultCallback = (res: TrackingResult) => {
      result = res;
    };

    const corruptFace = createMockFace(0.5, 0.5, 0.2);
    corruptFace[1].x = NaN;

    (processor as any).processLandmarkerResult({ faceLandmarks: [corruptFace] }, 1000);

    expect(result).not.toBeNull();
    expect(result!.faceDetected).toBe(false);
    expect(result!.quality).toBe('LOST');
  });
});
