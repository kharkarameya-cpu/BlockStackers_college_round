import { describe, it, expect, vi } from 'vitest';
import { CursorEngine } from '../core/cursor/CursorEngine';
import { TrackingTelemetry, DEFAULT_CALIBRATION_PROFILE } from '../types/tracking';

describe('CursorEngine', () => {
  it('should map neutral pose to screen center', () => {
    const engine = new CursorEngine(DEFAULT_CALIBRATION_PROFILE);
    let lastState: any = null;
    engine.setListeners((state) => {
      lastState = state;
    });

    const telemetry: TrackingTelemetry = {
      pose: {
        yaw: 0,
        pitch: 0,
        roll: 0,
        confidence: 0.9,
        faceDetected: true,
        timestamp: 1000,
      },
      uncertaintyRadius: 15,
      isTrackingStable: true,
      trackingLost: false,
    };

    engine.processTelemetry(telemetry);

    expect(lastState).not.toBeNull();
    // Default mock window size is typically 1024 or 0 in node/jsdom, but rawX should be normalized center
    expect(lastState.rawX).toBeGreaterThan(0);
    expect(lastState.trackingLost).toBe(false);
  });

  it('should safely pause and reset dwell when tracking is lost', () => {
    const engine = new CursorEngine(DEFAULT_CALIBRATION_PROFILE);
    let lastState: any = null;
    engine.setListeners((state) => {
      lastState = state;
    });

    // Lost telemetry
    const lostTelemetry: TrackingTelemetry = {
      pose: {
        yaw: 0,
        pitch: 0,
        roll: 0,
        confidence: 0,
        faceDetected: false,
        timestamp: 1000,
      },
      uncertaintyRadius: 40,
      isTrackingStable: false,
      trackingLost: true,
    };

    engine.processTelemetry(lostTelemetry);

    expect(lastState.trackingLost).toBe(true);
    expect(lastState.isDwelling).toBe(false);
    expect(lastState.dwellProgress).toBe(0);
  });

  it('should accumulate dwell progress and fire click after dwellDurationMs', () => {
    const customProfile = {
      ...DEFAULT_CALIBRATION_PROFILE,
      dwellDurationMs: 300,
    };
    const engine = new CursorEngine(customProfile);
    const clickSpy = vi.fn();
    let stateUpdates: any[] = [];

    engine.setListeners(
      (state) => stateUpdates.push({ ...state }),
      clickSpy
    );

    // Frame 1 at t = 0
    engine.processTelemetry({
      pose: { yaw: 0, pitch: 0, roll: 0, confidence: 0.9, faceDetected: true, timestamp: 0 },
      uncertaintyRadius: 15,
      isTrackingStable: true,
      trackingLost: false,
    });

    // Frame 2 at t = 150 (50% progress)
    engine.processTelemetry({
      pose: { yaw: 0, pitch: 0, roll: 0, confidence: 0.9, faceDetected: true, timestamp: 150 },
      uncertaintyRadius: 15,
      isTrackingStable: true,
      trackingLost: false,
    });

    const midState = stateUpdates[stateUpdates.length - 1];
    expect(midState.dwellProgress).toBeGreaterThanOrEqual(0.45);
    expect(clickSpy).not.toHaveBeenCalled();

    // Frame 3 at t = 350 (> 300ms, should trigger dwell click)
    engine.processTelemetry({
      pose: { yaw: 0, pitch: 0, roll: 0, confidence: 0.9, faceDetected: true, timestamp: 350 },
      uncertaintyRadius: 15,
      isTrackingStable: true,
      trackingLost: false,
    });

    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it('freezes cursor coordinates and cancels dwell during TEMPORARILY_LOST', () => {
    const engine = new CursorEngine(DEFAULT_CALIBRATION_PROFILE);
    const clickSpy = vi.fn();
    let currentState: any = null;

    engine.setListeners((state) => {
      currentState = { ...state };
    }, clickSpy);

    // Initial valid frame
    engine.processTelemetry({
      pose: { yaw: 0.1, pitch: 0, roll: 0, confidence: 0.9, faceDetected: true, timestamp: 1000 },
      uncertaintyRadius: 16,
      isTrackingStable: true,
      trackingLost: false,
      trackingState: 'TRACKING',
      isDwellAllowed: true,
    });

    const frozenX = currentState.x;
    const frozenY = currentState.y;

    // Temporary loss frame (head turned sideways)
    engine.processTelemetry({
      pose: { yaw: 0.1, pitch: 0, roll: 0, confidence: 0.7, faceDetected: true, timestamp: 1050 },
      uncertaintyRadius: 38,
      isTrackingStable: false,
      trackingLost: false,
      trackingState: 'TEMPORARILY_LOST',
      isDwellAllowed: false,
    });

    // Position MUST be frozen exactly
    expect(currentState.x).toBe(frozenX);
    expect(currentState.y).toBe(frozenY);
    expect(currentState.trackingLost).toBe(false);
    expect(currentState.isDwelling).toBe(false);
    expect(currentState.dwellProgress).toBe(0);
    expect(clickSpy).not.toHaveBeenCalled();
  });

  it('prevents dwell clicks when isDwellAllowed is false even if stationary', () => {
    const customProfile = {
      ...DEFAULT_CALIBRATION_PROFILE,
      dwellDurationMs: 200,
    };
    const engine = new CursorEngine(customProfile);
    const clickSpy = vi.fn();

    engine.setListeners(() => {}, clickSpy);

    // Frame at t = 0 with isDwellAllowed = false
    engine.processTelemetry({
      pose: { yaw: 0, pitch: 0, roll: 0, confidence: 0.8, faceDetected: true, timestamp: 0 },
      uncertaintyRadius: 20,
      isTrackingStable: true,
      trackingLost: false,
      trackingState: 'REACQUIRING',
      isDwellAllowed: false,
    });

    // Frame at t = 300 with isDwellAllowed = false
    engine.processTelemetry({
      pose: { yaw: 0, pitch: 0, roll: 0, confidence: 0.8, faceDetected: true, timestamp: 300 },
      uncertaintyRadius: 20,
      isTrackingStable: true,
      trackingLost: false,
      trackingState: 'REACQUIRING',
      isDwellAllowed: false,
    });

    expect(clickSpy).not.toHaveBeenCalled();
  });

  it('suppresses jitter within dead zone radius', () => {
    const profile = {
      ...DEFAULT_CALIBRATION_PROFILE,
      deadZoneRadius: 0.05,
    };
    const engine = new CursorEngine(profile);
    let state: any = null;
    engine.setListeners((s) => {
      state = s;
    });

    // Sub-threshold movement: yaw = 0.02, pitch = 0.02 (dist ~0.028 < 0.05)
    engine.processTelemetry({
      pose: { yaw: 0.02, pitch: 0.02, roll: 0, confidence: 0.9, faceDetected: true, timestamp: 0 },
      uncertaintyRadius: 15,
      isTrackingStable: true,
      trackingLost: false,
    });

    const viewW = typeof window !== 'undefined' ? window.innerWidth : 1920;
    const viewH = typeof window !== 'undefined' ? window.innerHeight : 1080;

    // Must be mapped exactly to screen center
    expect(state.rawX).toBeCloseTo(viewW * 0.5, 0);
    expect(state.rawY).toBeCloseTo(viewH * 0.5, 0);
  });

  it('scales cursor movement proportionally with sensitivity', () => {
    const lowSensEngine = new CursorEngine({
      ...DEFAULT_CALIBRATION_PROFILE,
      deadZoneRadius: 0,
      sensitivity: { x: 1.0, y: 1.0 },
    });
    const highSensEngine = new CursorEngine({
      ...DEFAULT_CALIBRATION_PROFILE,
      deadZoneRadius: 0,
      sensitivity: { x: 2.0, y: 2.0 },
    });

    let lowState: any = null;
    let highState: any = null;
    lowSensEngine.setListeners((s) => { lowState = s; });
    highSensEngine.setListeners((s) => { highState = s; });

    const telemetry = {
      pose: { yaw: 0.1, pitch: 0, roll: 0, confidence: 0.9, faceDetected: true, timestamp: 0 },
      uncertaintyRadius: 15,
      isTrackingStable: true,
      trackingLost: false,
    };

    lowSensEngine.processTelemetry(telemetry);
    highSensEngine.processTelemetry(telemetry);

    const viewW = typeof window !== 'undefined' ? window.innerWidth : 1920;
    const center = viewW * 0.5;

    const deltaLow = Math.abs(lowState.rawX - center);
    const deltaHigh = Math.abs(highState.rawX - center);

    expect(deltaHigh).toBeGreaterThan(deltaLow * 1.8);
  });

  it('recenters cursor to viewport center and allows resetting neutral calibration pose', () => {
    const engine = new CursorEngine(DEFAULT_CALIBRATION_PROFILE);
    let state: any = null;
    engine.setListeners((s) => { state = s; });

    // Move to some position
    engine.processTelemetry({
      pose: { yaw: 0.2, pitch: 0.2, roll: 0, confidence: 0.9, faceDetected: true, timestamp: 100 },
      uncertaintyRadius: 15,
      isTrackingStable: true,
      trackingLost: false,
    });

    // Call recenter with new neutral pose
    engine.recenter({ yaw: 0.2, pitch: 0.2 });

    const viewW = typeof window !== 'undefined' ? window.innerWidth : 1920;
    const viewH = typeof window !== 'undefined' ? window.innerHeight : 1080;

    expect(state.x).toBeCloseTo(viewW * 0.5, 0);
    expect(state.y).toBeCloseTo(viewH * 0.5, 0);

    // Now head at (0.2, 0.2) is considered neutral!
    engine.processTelemetry({
      pose: { yaw: 0.2, pitch: 0.2, roll: 0, confidence: 0.9, faceDetected: true, timestamp: 200 },
      uncertaintyRadius: 15,
      isTrackingStable: true,
      trackingLost: false,
    });

    expect(state.rawX).toBeCloseTo(viewW * 0.5, 0);
    expect(state.rawY).toBeCloseTo(viewH * 0.5, 0);
  });

  it('cancels and resets dwell progress when user drifts outside dwell radius', () => {
    const engine = new CursorEngine({
      ...DEFAULT_CALIBRATION_PROFILE,
      dwellDurationMs: 1000,
      dwellRadiusPx: 20,
    });
    let state: any = null;
    engine.setListeners((s) => { state = s; });

    // Anchor at center
    engine.processTelemetry({
      pose: { yaw: 0, pitch: 0, roll: 0, confidence: 0.9, faceDetected: true, timestamp: 0 },
      uncertaintyRadius: 15,
      isTrackingStable: true,
      trackingLost: false,
    });

    // Start dwelling
    engine.processTelemetry({
      pose: { yaw: 0, pitch: 0, roll: 0, confidence: 0.9, faceDetected: true, timestamp: 400 },
      uncertaintyRadius: 15,
      isTrackingStable: true,
      trackingLost: false,
    });
    expect(state.dwellProgress).toBeGreaterThan(0.3);

    // Drift far away
    engine.processTelemetry({
      pose: { yaw: 0.3, pitch: 0, roll: 0, confidence: 0.9, faceDetected: true, timestamp: 500 },
      uncertaintyRadius: 15,
      isTrackingStable: true,
      trackingLost: false,
    });

    // Dwell progress should have reset immediately
    expect(state.dwellProgress).toBe(0);
  });
});
