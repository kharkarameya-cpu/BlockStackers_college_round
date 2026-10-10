import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { CameraController } from '../core/vision/CameraController';
import { VisionProcessor } from '../core/vision/VisionProcessor';
import { ActiveTabManager } from '../background/ActiveTabManager';
import { CursorEngine } from '../core/cursor/CursorEngine';
import { DEFAULT_CALIBRATION_PROFILE } from '../types/tracking';
import { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { TrackingResult, HandLandmark } from '../types/vision';

describe('Handsfree Dual Pipeline & Active Tab Lifecycle', () => {
  // Helper to create mock face landmarks
  function createMockFace(noseX = 0.5, noseY = 0.5): NormalizedLandmark[] {
    const landmarks: NormalizedLandmark[] = [];
    for (let i = 0; i < 478; i++) {
      landmarks.push({ x: 0.5, y: 0.5, z: 0, visibility: 0.9 });
    }
    landmarks[1] = { x: noseX, y: noseY, z: 0, visibility: 0.95 };
    landmarks[33] = { x: 0.4, y: 0.45, z: 0, visibility: 0.95 };
    landmarks[263] = { x: 0.6, y: 0.45, z: 0, visibility: 0.95 };
    landmarks[10] = { x: 0.5, y: 0.25, z: 0, visibility: 0.95 };
    landmarks[152] = { x: 0.5, y: 0.75, z: 0, visibility: 0.95 };
    return landmarks;
  }

  // Helper to generate 21 anatomically correct hand landmarks
  function createPointingHand(indexX = 0.48, indexY = 0.35): HandLandmark[] {
    const lms: HandLandmark[] = [];
    lms.push({ x: 0.5, y: 0.8, z: 0 }); // 0: WRIST
    lms.push({ x: 0.45, y: 0.75, z: 0 }); // 1: Thumb CMC
    lms.push({ x: 0.42, y: 0.70, z: 0 }); // 2: Thumb MCP
    lms.push({ x: 0.40, y: 0.65, z: 0 }); // 3: Thumb IP
    lms.push({ x: 0.45, y: 0.68, z: 0 }); // 4: Thumb TIP (curled)
    lms.push({ x: 0.46, y: 0.55, z: 0 }); // 5: Index MCP
    lms.push({ x: 0.46, y: 0.45, z: 0 }); // 6: Index PIP
    lms.push({ x: 0.46, y: 0.40, z: 0 }); // 7: Index DIP
    lms.push({ x: indexX, y: indexY, z: 0 }); // 8: Index TIP (extended)
    lms.push({ x: 0.50, y: 0.55, z: 0 }); // 9: Middle MCP
    lms.push({ x: 0.50, y: 0.45, z: 0 }); // 10: Middle PIP
    lms.push({ x: 0.50, y: 0.40, z: 0 }); // 11: Middle DIP
    lms.push({ x: 0.50, y: 0.60, z: 0 }); // 12: Middle TIP (curled)
    lms.push({ x: 0.54, y: 0.56, z: 0 }); // 13: Ring MCP
    lms.push({ x: 0.54, y: 0.47, z: 0 }); // 14: Ring PIP
    lms.push({ x: 0.54, y: 0.42, z: 0 }); // 15: Ring DIP
    lms.push({ x: 0.54, y: 0.62, z: 0 }); // 16: Ring TIP (curled)
    lms.push({ x: 0.58, y: 0.58, z: 0 }); // 17: Pinky MCP
    lms.push({ x: 0.58, y: 0.50, z: 0 }); // 18: Pinky PIP
    lms.push({ x: 0.58, y: 0.45, z: 0 }); // 19: Pinky DIP
    lms.push({ x: 0.58, y: 0.64, z: 0 }); // 20: Pinky TIP (curled)
    return lms;
  }

  function createMockVideo() {
    const v: any = {
      style: {},
      setAttribute: vi.fn(),
      play: vi.fn().mockResolvedValue(undefined),
      videoWidth: 640,
      videoHeight: 480,
    };
    let cb: any = null;
    Object.defineProperty(v, 'onloadedmetadata', {
      get: () => cb,
      set: (fn) => {
        cb = fn;
        if (fn) setTimeout(() => fn(), 0);
      },
    });
    return v;
  }

  describe('1. CameraController Lifecycle & Hardware Faults', () => {
    let camera: CameraController;

    beforeEach(() => {
      camera = new CameraController(640, 480, 30);
    });

    afterEach(() => {
      camera.dispose();
      vi.restoreAllMocks();
    });

    it('handles camera permission denied with actionable error message', async () => {
      const mockGetUserMedia = vi.fn().mockRejectedValue(
        new DOMException('Permission denied', 'NotAllowedError')
      );

      vi.stubGlobal('navigator', {
        mediaDevices: {
          getUserMedia: mockGetUserMedia,
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        },
      });

      await expect(camera.start()).rejects.toThrow(/Camera permission was denied/);
      expect(camera.getMetrics().status).toBe('PERMISSION_DENIED');
      expect(camera.getMetrics().errorMessage).toContain('Please allow camera access in Chrome settings');
    });

    it('handles webcam hardware track ending unexpectedly', async () => {
      let trackEndCallback: (() => void) | null = null;
      const mockTrack = {
        readyState: 'live',
        stop: vi.fn(),
        addEventListener: vi.fn((event, cb) => {
          if (event === 'ended') trackEndCallback = cb;
        }),
        removeEventListener: vi.fn(),
      };

      const mockStream = {
        active: true,
        getTracks: () => [mockTrack],
        getVideoTracks: () => [mockTrack],
      };

      const mockVideo = createMockVideo();

      vi.stubGlobal('navigator', {
        mediaDevices: {
          getUserMedia: vi.fn().mockResolvedValue(mockStream),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        },
      });

      await camera.start(mockVideo);
      expect(camera.getMetrics().status).toBe('ACTIVE');

      // Trigger hardware track end
      expect(trackEndCallback).not.toBeNull();
      trackEndCallback!();

      expect(camera.getMetrics().status).toBe('DEVICE_DISCONNECTED');
      expect(mockTrack.stop).toHaveBeenCalled();
    });

    it('supports repeated enable/disable cycles without duplicate streams or dangling tracks', async () => {
      const mockStopTrack = vi.fn();
      const createMockStream = () => ({
        active: true,
        getTracks: () => [{ stop: mockStopTrack, removeEventListener: vi.fn() }],
        getVideoTracks: () => [{ stop: mockStopTrack, addEventListener: vi.fn(), removeEventListener: vi.fn() }],
      });

      const mockVideo = createMockVideo();

      vi.stubGlobal('navigator', {
        mediaDevices: {
          getUserMedia: vi.fn().mockImplementation(() => Promise.resolve(createMockStream())),
          addEventListener: vi.fn(),
          removeEventListener: vi.fn(),
        },
      });

      // Cycle 1
      await camera.start(mockVideo);
      expect(camera.getMetrics().status).toBe('ACTIVE');
      camera.stop();
      expect(camera.getMetrics().status).toBe('STOPPED');
      expect(mockStopTrack).toHaveBeenCalledTimes(1);

      // Cycle 2
      await camera.start(mockVideo);
      expect(camera.getMetrics().status).toBe('ACTIVE');
      camera.stop();
      expect(camera.getMetrics().status).toBe('STOPPED');
      expect(mockStopTrack).toHaveBeenCalledTimes(2);
    });
  });

  describe('2. Independent Face & Hand Pipeline in VisionProcessor', () => {
    let processor: VisionProcessor;

    beforeEach(() => {
      processor = new VisionProcessor();
    });

    afterEach(() => {
      processor.dispose();
    });

    it('face detection succeeds while hand detection returns no landmarks', () => {
      let result: TrackingResult | null = null;
      (processor as any).onResultCallback = (res: TrackingResult) => {
        result = res;
      };

      const face = createMockFace(0.5, 0.5);
      processor.processCombinedResults(
        { faceLandmarks: [face] } as any,
        { landmarks: [] } as any,
        1000
      );

      expect(result).not.toBeNull();
      expect(result!.faceDetected).toBe(true);
      expect(result!.handDetected).toBe(false);
      expect(result!.faceStatus).toBe('TRACKING');
      expect(result!.handStatus).toBe('NOT_VISIBLE');
      expect(result!.activeSource).toBe('FACE');
      expect(result!.quality).toBe('OPTIMAL');
      expect(result!.confidence).toBeGreaterThan(0.6);
    });

    it('hand detection succeeds while face detection returns no landmarks', () => {
      let result: TrackingResult | null = null;
      (processor as any).onResultCallback = (res: TrackingResult) => {
        result = res;
      };

      const hand = createPointingHand(0.3, 0.4);
      processor.processCombinedResults(
        { faceLandmarks: [] } as any,
        { landmarks: [hand as any], handedness: [[{ categoryName: 'Right', score: 0.92 }]] } as any,
        1000
      );

      expect(result).not.toBeNull();
      expect(result!.faceDetected).toBe(false);
      expect(result!.handDetected).toBe(true);
      expect(result!.faceStatus).toBe('NOT_VISIBLE');
      expect(result!.handStatus).toBe('TRACKING');
      expect(result!.activeSource).toBe('HAND');
      expect(result!.cursorNormalizedX).toBeDefined();
      expect(result!.cursorNormalizedY).toBeDefined();
      expect(result!.activeGesture).toBe('POINTING');
      expect(result!.confidence).toBeGreaterThan(0.5);
    });

    it('allows hand-only tracking mode to control cursor without initializing face landmarks', () => {
      processor.setTrackingMode('HAND_ONLY');
      let result: TrackingResult | null = null;
      (processor as any).onResultCallback = (res: TrackingResult) => {
        result = res;
      };

      const hand = createPointingHand(0.25, 0.35);
      processor.processCombinedResults(
        null,
        { landmarks: [hand as any], handedness: [[{ categoryName: 'Right', score: 0.95 }]] } as any,
        1000
      );

      expect(result).not.toBeNull();
      expect(result!.activeSource).toBe('HAND');
      expect(result!.handDetected).toBe(true);
      expect(result!.faceDetected).toBe(false);
    });

    it('accurately distinguishes missing face from error state', () => {
      let result: TrackingResult | null = null;
      (processor as any).onResultCallback = (res: TrackingResult) => {
        result = res;
      };

      // Case A: Model ran normally, but user is simply not visible
      processor.processCombinedResults({ faceLandmarks: [] } as any, null, 1000);
      expect(result!.faceStatus).toBe('NOT_VISIBLE');
      expect(result!.faceDetected).toBe(false);
      expect(result!.faceError).toBeNull();

      // Case B: Model encountered error
      (processor as any).faceStatus = 'ERROR';
      (processor as any).faceError = 'GPU context lost';
      processor.processCombinedResults(null, null, 1033);
      expect(result!.faceStatus).toBe('ERROR');
      expect(result!.faceError).toBe('GPU context lost');
    });
  });

  describe('3. CursorEngine Direct Hand Pointer vs Head Pose Mapping', () => {
    let engine: CursorEngine;

    beforeEach(() => {
      engine = new CursorEngine(DEFAULT_CALIBRATION_PROFILE);
    });

    it('maps index-finger tip directly to viewport in hand mode without head dead zone attenuation', () => {
      let state: any = null;
      engine.setListeners((s) => {
        state = s;
      });

      engine.processTelemetry({
        pose: { yaw: 0, pitch: 0, roll: 0, confidence: 0.9, faceDetected: false, timestamp: 1000 },
        uncertaintyRadius: 14,
        isTrackingStable: true,
        trackingLost: false,
        handDetected: true,
        cursorNormalizedX: 0.75,
        cursorNormalizedY: 0.25,
        isDwellAllowed: true,
      });

      expect(state).not.toBeNull();
      expect(state.trackingLost).toBe(false);
      const viewWidth = typeof window !== 'undefined' ? window.innerWidth : 1920;
      const viewHeight = typeof window !== 'undefined' ? window.innerHeight : 1080;
      const expectedX = 0.75 * viewWidth;
      const expectedY = 0.25 * viewHeight;
      expect(Math.abs(state.rawX - expectedX)).toBeLessThan(1.0);
      expect(Math.abs(state.rawY - expectedY)).toBeLessThan(1.0);
    });

    it('never triggers dwell activation when tracking target is lost', () => {
      let clicked = false;
      engine.setListeners(
        () => {},
        () => {
          clicked = true;
        }
      );

      engine.processTelemetry({
        pose: { yaw: 0, pitch: 0, roll: 0, confidence: 0, faceDetected: false, timestamp: 1000 },
        uncertaintyRadius: 48,
        isTrackingStable: false,
        trackingLost: true,
        handDetected: false,
        isDwellAllowed: false,
      });

      expect(clicked).toBe(false);
      expect(engine.getCurrentState().isDwelling).toBe(false);
    });
  });

  describe('4. ActiveTabManager Eligibility & Lifecycle', () => {
    it('correctly filters supported web pages from restricted internal browser URLs', () => {
      // Eligible URLs
      expect(ActiveTabManager.isEligibleUrl('https://en.wikipedia.org/wiki/Web_accessibility')).toBe(true);
      expect(ActiveTabManager.isEligibleUrl('http://localhost:3000/dashboard')).toBe(true);
      expect(ActiveTabManager.isEligibleUrl('file:///C:/Users/test/index.html')).toBe(true);

      // Ineligible / Restricted URLs
      expect(ActiveTabManager.isEligibleUrl('chrome://extensions')).toBe(false);
      expect(ActiveTabManager.isEligibleUrl('chrome://settings')).toBe(false);
      expect(ActiveTabManager.isEligibleUrl('chrome-extension://abcdef/popup.html')).toBe(false);
      expect(ActiveTabManager.isEligibleUrl('edge://settings')).toBe(false);
      expect(ActiveTabManager.isEligibleUrl('about:blank')).toBe(false);
      expect(ActiveTabManager.isEligibleUrl('view-source:https://example.com')).toBe(false);
      expect(ActiveTabManager.isEligibleUrl('https://chromewebstore.google.com/detail/123')).toBe(false);
      expect(ActiveTabManager.isEligibleUrl('https://chrome.google.com/webstore/detail/123')).toBe(false);
    });

    it('syncs active tab and routes pose update without unhandled rejections', () => {
      const mockSendMessage = vi.fn();
      vi.stubGlobal('chrome', {
        tabs: {
          query: vi.fn((_q, cb) => cb([{ id: 101, url: 'https://example.com' }])),
          onActivated: { addListener: vi.fn() },
          onUpdated: { addListener: vi.fn() },
          onRemoved: { addListener: vi.fn() },
          sendMessage: mockSendMessage,
        },
        windows: { onFocusChanged: { addListener: vi.fn() } },
        runtime: { lastError: null },
      });

      const manager = ActiveTabManager.getInstance();
      manager.syncActiveTab();

      const status = manager.getStatus();
      expect(status.activeTabId).toBe(101);
      expect(status.isEligible).toBe(true);
    });
  });
});
