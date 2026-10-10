/**
 * Handsfree Adaptive Effort Engine
 * Monitors minimal derived interaction metrics to make conservative, bounded adjustments
 * to cursor sensitivity, dead zone, and dwell duration.
 *
 * Safety Constraints:
 * 1. Bounded limits to prevent sudden cursor jumps.
 * 2. User-controlled: can be enabled, disabled, or reset anytime.
 * 3. Does NOT diagnose medical conditions or retain raw biometric data.
 */

import { CalibrationProfile } from '../../types/tracking';

export interface EffortSignals {
  abortedDwellsCount: number;
  recenteringCount: number;
  highJitterCount: number;
  consecutiveSuccessfulClicks: number;
}

export class AdaptiveEffortEngine {
  private enabled: boolean = true;
  private signals: EffortSignals = {
    abortedDwellsCount: 0,
    recenteringCount: 0,
    highJitterCount: 0,
    consecutiveSuccessfulClicks: 0,
  };

  constructor(enabled: boolean = true) {
    this.enabled = enabled;
  }

  public setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  public getIsEnabled(): boolean {
    return this.enabled;
  }

  public recordAbortedDwell(): void {
    this.signals.abortedDwellsCount++;
    this.signals.consecutiveSuccessfulClicks = 0;
  }

  public recordRecentering(): void {
    this.signals.recenteringCount++;
  }

  public recordJitterEpisode(): void {
    this.signals.highJitterCount++;
  }

  public recordSuccessfulClick(): void {
    this.signals.consecutiveSuccessfulClicks++;
  }

  /**
   * Evaluates accumulated signals and applies conservative, bounded profile adaptations
   */
  public evaluateAdaptation(currentProfile: CalibrationProfile): CalibrationProfile {
    if (!this.enabled) return currentProfile;

    let updated = false;
    let newDeadZone = currentProfile.deadZoneRadius;
    let newDwellDuration = currentProfile.dwellDurationMs;
    let newSensX = currentProfile.sensitivity.x;
    let newSensY = currentProfile.sensitivity.y;

    // 1. High Jitter / Tremor Detection: Gently widen dead zone (max 0.05)
    if (this.signals.highJitterCount >= 4) {
      newDeadZone = Math.min(0.045, currentProfile.deadZoneRadius + 0.003);
      this.signals.highJitterCount = 0;
      updated = true;
    }

    // 2. High Aborted Dwells: User is struggling to maintain dwell anchor; slightly increase dwell radius or reduce dwell time
    if (this.signals.abortedDwellsCount >= 5) {
      newDwellDuration = Math.max(900, currentProfile.dwellDurationMs - 50);
      this.signals.abortedDwellsCount = 0;
      updated = true;
    }

    // 3. Frequent Recentering: User is overshooting or range is too narrow; slightly reduce sensitivity (min 0.8)
    if (this.signals.recenteringCount >= 4) {
      newSensX = Math.max(0.85, currentProfile.sensitivity.x - 0.05);
      newSensY = Math.max(0.85, currentProfile.sensitivity.y - 0.05);
      this.signals.recenteringCount = 0;
      updated = true;
    }

    if (!updated) return currentProfile;

    return {
      ...currentProfile,
      deadZoneRadius: newDeadZone,
      dwellDurationMs: newDwellDuration,
      sensitivity: { x: newSensX, y: newSensY },
      updatedAt: Date.now(),
    };
  }

  public resetSignals(): void {
    this.signals = {
      abortedDwellsCount: 0,
      recenteringCount: 0,
      highJitterCount: 0,
      consecutiveSuccessfulClicks: 0,
    };
  }
}
