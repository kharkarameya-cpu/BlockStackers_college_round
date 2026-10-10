import { TrackingState, TrackingResult } from '../../types/vision';

export interface StateMachineConfig {
  /** Grace period duration in milliseconds before declaring permanent face loss (default: 350ms) */
  gracePeriodMs: number;
  /** Max consecutive lost frames during grace period before declaring permanent loss (default: 6) */
  maxGraceFrames: number;
  /** Number of consecutive valid observations needed to transition to TRACKING (default: 1) */
  acquireFrameThreshold: number;
  /** Number of consecutive valid observations needed to transition to TRACKING upon reacquisition (default: 1) */
  reacquireFrameThreshold: number;
}

export const DEFAULT_STATE_MACHINE_CONFIG: StateMachineConfig = {
  gracePeriodMs: 350,
  maxGraceFrames: 5,
  acquireFrameThreshold: 1,
  reacquireFrameThreshold: 1,
};

export class TrackingStateMachine {
  private state: TrackingState = 'NO_FACE';
  private consecutiveValidFrames: number = 0;
  private consecutiveLostFrames: number = 0;
  private lostStartTimestamp: number | null = null;
  private stateEnteredTimestamp: number = 0;
  private lastTrustedResult: TrackingResult | null = null;
  private reacquiredFlag: boolean = false;
  private totalTransitions: number = 0;
  private rejectedObservationsCount: number = 0;

  constructor(private config: StateMachineConfig = DEFAULT_STATE_MACHINE_CONFIG) {
    this.stateEnteredTimestamp = typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  public getState(): TrackingState {
    return this.state;
  }

  public getLastTrustedResult(): TrackingResult | null {
    return this.lastTrustedResult;
  }

  public getStats() {
    return {
      state: this.state,
      totalTransitions: this.totalTransitions,
      rejectedObservationsCount: this.rejectedObservationsCount,
      timeInCurrentStateMs: (typeof performance !== 'undefined' ? performance.now() : Date.now()) - this.stateEnteredTimestamp,
    };
  }

  /**
   * Whether tracking data is safe and usable for cursor positioning.
   * True during active TRACKING, or during TEMPORARILY_LOST when freezing position.
   */
  public isTrackingUsable(): boolean {
    return this.state === 'TRACKING' || this.state === 'TEMPORARILY_LOST';
  }

  /**
   * Whether cursor should be frozen at its last known safe position.
   */
  public shouldFreezeCursor(): boolean {
    return this.state === 'TEMPORARILY_LOST';
  }

  /**
   * Whether dwell activation (clicks, actions) is strictly permitted.
   * NEVER allowed during TEMPORARILY_LOST, REACQUIRING, ACQUIRING, or NO_FACE.
   */
  public isDwellAllowed(): boolean {
    return this.state === 'TRACKING';
  }

  /**
   * Check and consume reacquisition flag. True once upon returning to TRACKING from loss.
   */
  public consumeReacquisition(): boolean {
    if (this.reacquiredFlag) {
      this.reacquiredFlag = false;
      return true;
    }
    return false;
  }

  /**
   * Process a single frame observation from the detector.
   * @param observation Valid TrackingResult or null/undefined if no face was observed
   * @param timestamp Frame timestamp in milliseconds
   */
  public processObservation(
    observation: TrackingResult | null,
    timestamp: number
  ): TrackingResult {
    const hasValidObservation = Boolean(
      observation &&
      (observation.faceDetected || observation.handDetected) &&
      Number.isFinite(observation.normalizedX) &&
      Number.isFinite(observation.normalizedY)
    );

    if (observation && !hasValidObservation) {
      this.rejectedObservationsCount++;
    }

    switch (this.state) {
      case 'NO_FACE': {
        if (hasValidObservation) {
          if (this.config.acquireFrameThreshold <= 1) {
            this.transitionTo('TRACKING', timestamp);
            this.lastTrustedResult = observation;
            this.consecutiveValidFrames = 1;
          } else {
            this.transitionTo('ACQUIRING', timestamp);
            this.consecutiveValidFrames = 1;
          }
        }
        break;
      }

      case 'ACQUIRING': {
        if (hasValidObservation) {
          this.consecutiveValidFrames++;
          if (this.consecutiveValidFrames >= this.config.acquireFrameThreshold) {
            this.transitionTo('TRACKING', timestamp);
            this.lastTrustedResult = observation;
          }
        } else {
          // False alarm or blip; return to NO_FACE
          this.transitionTo('NO_FACE', timestamp);
          this.consecutiveValidFrames = 0;
        }
        break;
      }

      case 'TRACKING': {
        if (hasValidObservation) {
          this.lastTrustedResult = observation;
          this.consecutiveLostFrames = 0;
        } else {
          // Missed frame / momentary profile occlusion: initiate grace period
          this.transitionTo('TEMPORARILY_LOST', timestamp);
          this.lostStartTimestamp = timestamp;
          this.consecutiveLostFrames = 1;
        }
        break;
      }

      case 'TEMPORARILY_LOST': {
        if (hasValidObservation) {
          // Face reappeared within grace period
          if (this.config.reacquireFrameThreshold <= 1) {
            this.transitionTo('TRACKING', timestamp);
            this.lastTrustedResult = observation;
            this.reacquiredFlag = true;
            this.consecutiveValidFrames = 1;
            this.consecutiveLostFrames = 0;
          } else {
            this.transitionTo('REACQUIRING', timestamp);
            this.consecutiveValidFrames = 1;
            this.consecutiveLostFrames = 0;
          }
        } else {
          // Still missing; check if grace period or max lost frames expired
          this.consecutiveLostFrames++;
          const elapsedMs = this.lostStartTimestamp !== null ? timestamp - this.lostStartTimestamp : Infinity;
          if (elapsedMs > this.config.gracePeriodMs || this.consecutiveLostFrames > this.config.maxGraceFrames) {
            this.transitionTo('NO_FACE', timestamp);
            this.lastTrustedResult = null;
            this.lostStartTimestamp = null;
            this.consecutiveLostFrames = 0;
          }
        }
        break;
      }

      case 'REACQUIRING': {
        if (hasValidObservation) {
          this.consecutiveValidFrames++;
          if (this.consecutiveValidFrames >= this.config.reacquireFrameThreshold) {
            this.transitionTo('TRACKING', timestamp);
            this.lastTrustedResult = observation;
            this.reacquiredFlag = true;
          }
        } else {
          // Lost again during verification
          this.transitionTo('TEMPORARILY_LOST', timestamp);
          this.lostStartTimestamp = timestamp;
          this.consecutiveLostFrames = 1;
        }
        break;
      }
    }

    // Produce downstream safe result based on active state
    if (this.state === 'TRACKING' && observation) {
      return {
        ...observation,
        trackingState: 'TRACKING',
      };
    }

    if (this.state === 'TEMPORARILY_LOST' && this.lastTrustedResult) {
      return {
        ...this.lastTrustedResult,
        timestamp,
        quality: 'DEGRADED',
        confidence: Math.max(0.35, this.lastTrustedResult.confidence * 0.85),
        trackingState: 'TEMPORARILY_LOST',
      };
    }

    if (this.state === 'REACQUIRING' && this.lastTrustedResult) {
      return {
        ...this.lastTrustedResult,
        timestamp,
        quality: 'DEGRADED',
        confidence: Math.max(0.45, this.lastTrustedResult.confidence * 0.9),
        trackingState: 'REACQUIRING',
      };
    }

    // Default NO_FACE or ACQUIRING result
    return {
      timestamp,
      normalizedX: 0,
      normalizedY: 0,
      yaw: 0,
      pitch: 0,
      roll: 0,
      confidence: 0,
      quality: 'LOST',
      faceDetected: false,
      handDetected: false,
      handsDetected: 0,
      hands: [],
      activeHand: null,
      activeGesture: 'UNKNOWN',
      multipleFacesDetected: false,
      landmarksCount: 0,
      trackingState: this.state,
    };
  }

  private transitionTo(newState: TrackingState, _timestamp: number): void {
    if (this.state !== newState) {
      this.state = newState;
      this.stateEnteredTimestamp = typeof performance !== 'undefined' ? performance.now() : Date.now();
      this.totalTransitions++;
    }
  }

  public reset(): void {
    this.state = 'NO_FACE';
    this.consecutiveValidFrames = 0;
    this.consecutiveLostFrames = 0;
    this.lostStartTimestamp = null;
    this.lastTrustedResult = null;
    this.reacquiredFlag = false;
    this.totalTransitions = 0;
    this.rejectedObservationsCount = 0;
  }
}
