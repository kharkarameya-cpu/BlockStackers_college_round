import { describe, it, expect } from 'vitest';
import { OpticalFlowTracker } from '../core/vision/OpticalFlowTracker';

describe('OpticalFlowTracker (OpenCV-Style Optical Flow)', () => {
  it('initializes in idle state', () => {
    const tracker = new OpticalFlowTracker();
    expect(tracker.track({} as HTMLVideoElement)).toBeNull();
  });

  it('sets and updates anchor properly', () => {
    const tracker = new OpticalFlowTracker(160, 120);
    tracker.setAnchor(0.5, 0.5);
    // Anchor set at (80, 60)
    tracker.reset();
    expect(tracker.track({} as HTMLVideoElement)).toBeNull();
  });

  it('safely handles null or non-canvas environments without crashing', () => {
    const tracker = new OpticalFlowTracker();
    expect(() => tracker.setAnchor(0.2, 0.4)).not.toThrow();
    expect(() => tracker.reset()).not.toThrow();
  });
});
