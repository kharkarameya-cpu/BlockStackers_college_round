import { describe, it, expect } from 'vitest';
import { TrackingStateMachine } from '../core/vision/TrackingStateMachine';
import { TrackingResult } from '../types/vision';

describe('TrackingStateMachine Temporal Robustness', () => {
  const createMockResult = (x = 0, y = 0, yaw = 0, pitch = 0): TrackingResult => ({
    timestamp: 1000,
    normalizedX: x,
    normalizedY: y,
    yaw,
    pitch,
    roll: 0,
    confidence: 0.85,
    quality: 'OPTIMAL',
    faceDetected: true,
    handDetected: true,
    handsDetected: 1,
    hands: [],
    activeHand: null,
    activeGesture: 'POINTING',
    multipleFacesDetected: false,
    landmarksCount: 478,
  });

  it('starts in NO_FACE state and transitions to TRACKING on valid observation', () => {
    const sm = new TrackingStateMachine();
    expect(sm.getState()).toBe('NO_FACE');
    expect(sm.isTrackingUsable()).toBe(false);
    expect(sm.isDwellAllowed()).toBe(false);

    const obs = createMockResult(0.1, -0.05, 0.1, -0.05);
    const res = sm.processObservation(obs, 1000);

    expect(sm.getState()).toBe('TRACKING');
    expect(res.trackingState).toBe('TRACKING');
    expect(res.faceDetected).toBe(true);
    expect(sm.isTrackingUsable()).toBe(true);
    expect(sm.isDwellAllowed()).toBe(true);
  });

  it('rejects observations with non-finite or corrupted values', () => {
    const sm = new TrackingStateMachine();
    const badObs: TrackingResult = {
      ...createMockResult(),
      yaw: NaN,
      normalizedX: Infinity,
    };

    const res = sm.processObservation(badObs, 1000);
    expect(sm.getState()).toBe('NO_FACE');
    expect(res.faceDetected).toBe(false);
    expect(sm.getStats().rejectedObservationsCount).toBe(1);
  });

  it('initiates TEMPORARILY_LOST grace period upon momentary frame loss', () => {
    const sm = new TrackingStateMachine({
      gracePeriodMs: 350,
      maxGraceFrames: 8,
      acquireFrameThreshold: 1,
      reacquireFrameThreshold: 1,
    });

    const obs = createMockResult(0.2, 0.1, 0.2, 0.1);
    sm.processObservation(obs, 1000);
    expect(sm.getState()).toBe('TRACKING');

    // Frame dropped (e.g. side profile turn)
    const graceRes = sm.processObservation(null, 1033);
    expect(sm.getState()).toBe('TEMPORARILY_LOST');
    expect(graceRes.trackingState).toBe('TEMPORARILY_LOST');
    expect(graceRes.faceDetected).toBe(true);
    expect(graceRes.quality).toBe('DEGRADED');

    // Strict requirements during temporary loss
    expect(sm.shouldFreezeCursor()).toBe(true);
    expect(sm.isTrackingUsable()).toBe(true);
    expect(sm.isDwellAllowed()).toBe(false); // Dwell clicks strictly forbidden
  });

  it('reacquires face smoothly when face returns within grace period', () => {
    const sm = new TrackingStateMachine({
      gracePeriodMs: 350,
      maxGraceFrames: 8,
      acquireFrameThreshold: 1,
      reacquireFrameThreshold: 1,
    });

    const obs1 = createMockResult(0.3, 0.1, 0.3, 0.1);
    sm.processObservation(obs1, 1000);

    // Frame lost at 1033ms
    sm.processObservation(null, 1033);
    expect(sm.getState()).toBe('TEMPORARILY_LOST');

    // Frame recovered at 1100ms (77ms elapsed, well within 350ms grace)
    const obs2 = createMockResult(0.32, 0.11, 0.32, 0.11);
    const reacquiredRes = sm.processObservation(obs2, 1100);

    expect(sm.getState()).toBe('TRACKING');
    expect(reacquiredRes.trackingState).toBe('TRACKING');
    expect(sm.isDwellAllowed()).toBe(true);
    expect(sm.consumeReacquisition()).toBe(true);
    // Consuming a second time should return false
    expect(sm.consumeReacquisition()).toBe(false);
  });

  it('transitions to NO_FACE after grace period expires (>350ms)', () => {
    const sm = new TrackingStateMachine({
      gracePeriodMs: 350,
      maxGraceFrames: 8,
      acquireFrameThreshold: 1,
      reacquireFrameThreshold: 1,
    });

    const obs = createMockResult(0.1, 0.1, 0.1, 0.1);
    sm.processObservation(obs, 1000);

    // Initial loss at 1033ms
    sm.processObservation(null, 1033);
    expect(sm.getState()).toBe('TEMPORARILY_LOST');

    // Call after 400ms has elapsed (> 350ms grace period)
    const finalRes = sm.processObservation(null, 1450);
    expect(sm.getState()).toBe('NO_FACE');
    expect(finalRes.trackingState).toBe('NO_FACE');
    expect(finalRes.faceDetected).toBe(false);
    expect(finalRes.quality).toBe('LOST');
    expect(sm.isTrackingUsable()).toBe(false);
    expect(sm.isDwellAllowed()).toBe(false);
  });

  it('clears state cleanly on reset()', () => {
    const sm = new TrackingStateMachine();
    sm.processObservation(createMockResult(), 1000);
    expect(sm.getState()).toBe('TRACKING');

    sm.reset();
    expect(sm.getState()).toBe('NO_FACE');
    expect(sm.getLastTrustedResult()).toBeNull();
    expect(sm.isTrackingUsable()).toBe(false);
  });
});
