import { OneEuroFilter2D } from '../filters/OneEuroFilter';
import {
  CalibrationProfile,
  DEFAULT_CALIBRATION_PROFILE,
  DEFAULT_ONE_EURO_PARAMS,
  OneEuroParams,
  TrackingTelemetry,
} from '../../types/tracking';
import { TrackingState, HandGesture } from '../../types/vision';

export interface CursorState {
  x: number;
  y: number;
  rawX: number;
  rawY: number;
  uncertaintyRadius: number;
  dwellProgress: number; // 0.0 to 1.0
  isDwelling: boolean;
  trackingLost: boolean;
  trackingState?: TrackingState;
  isPaused: boolean;
  activeGesture?: HandGesture;
  isPinching?: boolean;
}

export type CursorUpdateListener = (state: CursorState) => void;
export type DwellClickListener = (x: number, y: number) => void;
export type GestureListener = (gesture: HandGesture, x: number, y: number) => void;

export class CursorEngine {
  private filter: OneEuroFilter2D;
  private profile: CalibrationProfile;
  private currentState: CursorState;
  private onUpdate: CursorUpdateListener | null = null;
  private onDwellClick: DwellClickListener | null = null;
  private onGesture: GestureListener | null = null;
  private lastPinchActive: boolean = false;

  // Dwell state
  private dwellAnchorX: number = 0;
  private dwellAnchorY: number = 0;
  private dwellStartTime: number | null = null;
  private hasTriggeredDwellThisCycle: boolean = false;

  // Tracking state machine awareness & anti-jump reacquisition flag
  private wasTemporarilyLost: boolean = false;

  constructor(
    profile: CalibrationProfile = DEFAULT_CALIBRATION_PROFILE,
    filterParams: OneEuroParams = DEFAULT_ONE_EURO_PARAMS
  ) {
    this.profile = profile;
    this.filter = new OneEuroFilter2D(
      filterParams.minCutoff,
      filterParams.beta,
      filterParams.dCutoff
    );

    const initX = typeof window !== 'undefined' ? window.innerWidth / 2 : 500;
    const initY = typeof window !== 'undefined' ? window.innerHeight / 2 : 400;

    this.currentState = {
      x: initX,
      y: initY,
      rawX: initX,
      rawY: initY,
      uncertaintyRadius: 20,
      dwellProgress: 0,
      isDwelling: false,
      trackingLost: false,
      trackingState: 'NO_FACE',
      isPaused: false,
    };
  }

  public setCalibrationProfile(profile: CalibrationProfile): void {
    this.profile = profile;
  }

  public setFilterParams(params: OneEuroParams): void {
    this.filter.setParams(params.minCutoff, params.beta, params.dCutoff);
  }

  public setListeners(
    onUpdate: CursorUpdateListener,
    onDwellClick?: DwellClickListener,
    onGesture?: GestureListener
  ): void {
    this.onUpdate = onUpdate;
    if (onDwellClick) this.onDwellClick = onDwellClick;
    if (onGesture) this.onGesture = onGesture;
  }

  public setPaused(paused: boolean): void {
    this.currentState.isPaused = paused;
    this.resetDwell();
    if (this.onUpdate) this.onUpdate(this.currentState);
  }

  public getCurrentState(): CursorState {
    return { ...this.currentState };
  }

  /**
   * Process an incoming telemetry frame from the vision processor
   */
  public processTelemetry(telemetry: TrackingTelemetry): void {
    const timestamp = telemetry.pose.timestamp;
    const trackingState = telemetry.trackingState || (telemetry.pose.faceDetected || telemetry.handDetected ? 'TRACKING' : 'NO_FACE');
    this.currentState.trackingState = trackingState;
    this.currentState.activeGesture = telemetry.activeGesture;
    this.currentState.isPinching = telemetry.isPinching;

    // 1. Paused state
    if (this.currentState.isPaused) {
      this.resetDwell();
      if (this.onUpdate) this.onUpdate(this.currentState);
      return;
    }

    // 2. Closed Fist Gesture: Freezes cursor movement instantly for stability
    if (telemetry.activeGesture === 'CLOSED_FIST') {
      this.resetDwell();
      if (this.onUpdate) this.onUpdate(this.currentState);
      return;
    }

    // 3. Pinch-to-Click Gesture detection (leading edge)
    if (telemetry.activeGesture === 'PINCH' || telemetry.isPinching) {
      if (!this.lastPinchActive) {
        this.lastPinchActive = true;
        if (this.onDwellClick) {
          this.onDwellClick(this.currentState.x, this.currentState.y);
        }
      }
    } else {
      this.lastPinchActive = false;
    }

    // Forward discrete gestures (Two fingers scroll, Thumbs up/down, etc.)
    if (
      this.onGesture &&
      telemetry.activeGesture &&
      telemetry.activeGesture !== 'UNKNOWN' &&
      telemetry.activeGesture !== 'POINTING' &&
      telemetry.activeGesture !== 'PINCH'
    ) {
      this.onGesture(telemetry.activeGesture, this.currentState.x, this.currentState.y);
    }

    // 4. Temporary Loss Grace Period (e.g. momentary occlusion)
    // Freeze cursor at current filtered coordinates, suppress dwell without clicking
    if (trackingState === 'TEMPORARILY_LOST') {
      this.currentState.trackingLost = false;
      this.currentState.uncertaintyRadius = 38;
      this.wasTemporarilyLost = true;
      this.resetDwell();
      if (this.onUpdate) this.onUpdate(this.currentState);
      return;
    }

    // 5. Permanent Tracking Loss (grace period expired or neither hand nor face detected)
    const hasTarget = Boolean(telemetry.handDetected || telemetry.pose.faceDetected || telemetry.faceDetected);
    if (trackingState === 'NO_FACE' || telemetry.trackingLost || !hasTarget) {
      this.currentState.trackingLost = true;
      this.currentState.uncertaintyRadius = 48;
      this.wasTemporarilyLost = false;
      this.resetDwell();
      if (this.onUpdate) this.onUpdate(this.currentState);
      return;
    }

    // 6. Target Reacquisition / Active Tracking
    this.currentState.trackingLost = false;
    this.currentState.uncertaintyRadius = telemetry.uncertaintyRadius;

    // Smooth transition upon reacquisition: re-seed filter anchor to prevent sudden cursor jumps
    if (this.wasTemporarilyLost) {
      this.filter.filter(this.currentState.x, this.currentState.y, Math.max(0, timestamp - 16));
      this.wasTemporarilyLost = false;
    }

    const viewWidth = typeof window !== 'undefined' ? window.innerWidth : 1920;
    const viewHeight = typeof window !== 'undefined' ? window.innerHeight : 1080;

    let rawPxX: number;
    let rawPxY: number;

    const isHandMode = Boolean(
      telemetry.handDetected &&
      typeof telemetry.cursorNormalizedX === 'number' &&
      typeof telemetry.cursorNormalizedY === 'number' &&
      Number.isFinite(telemetry.cursorNormalizedX) &&
      Number.isFinite(telemetry.cursorNormalizedY)
    );

    if (isHandMode) {
      // Direct Hand Pointer Mapping (Index finger tip normalized 0..1 in viewport)
      let normX = telemetry.cursorNormalizedX!;
      let normY = telemetry.cursorNormalizedY!;

      if (this.profile.invertX) normX = 1.0 - normX;
      if (this.profile.invertY) normY = 1.0 - normY;

      rawPxX = Math.max(0, Math.min(viewWidth, normX * viewWidth));
      rawPxY = Math.max(0, Math.min(viewHeight, normY * viewHeight));
    } else {
      // Head Pose mapping with Calibration
      let dx = telemetry.pose.yaw - this.profile.neutralPose.yaw;
      let dy = telemetry.pose.pitch - this.profile.neutralPose.pitch;

      // Mirroring & Inversion
      if (this.profile.invertX) dx = -dx;
      if (this.profile.invertY) dy = -dy;

      // Dead Zone check
      const distFromNeutral = Math.hypot(dx, dy);
      if (distFromNeutral < this.profile.deadZoneRadius) {
        dx = 0;
        dy = 0;
      } else {
        // Smoothly subtract dead zone radius to prevent jump
        const scale = (distFromNeutral - this.profile.deadZoneRadius) / distFromNeutral;
        dx *= scale;
        dy *= scale;
      }

      // Sensitivity & Range Mapping
      const spanX = Math.max(0.05, (this.profile.rangeX.max - this.profile.rangeX.min) / 2);
      const spanY = Math.max(0.05, (this.profile.rangeY.max - this.profile.rangeY.min) / 2);

      const normX = 0.5 + (dx / spanX) * 0.5 * this.profile.sensitivity.x;
      const normY = 0.5 + (dy / spanY) * 0.5 * this.profile.sensitivity.y;

      rawPxX = Math.max(0, Math.min(viewWidth, normX * viewWidth));
      rawPxY = Math.max(0, Math.min(viewHeight, normY * viewHeight));
    }

    const fallbackX = Number.isFinite(this.currentState.x) ? this.currentState.x : viewWidth / 2;
    const fallbackY = Number.isFinite(this.currentState.y) ? this.currentState.y : viewHeight / 2;

    if (!Number.isFinite(rawPxX)) rawPxX = fallbackX;
    if (!Number.isFinite(rawPxY)) rawPxY = fallbackY;

    this.currentState.rawX = rawPxX;
    this.currentState.rawY = rawPxY;

    // One Euro Filter smoothing
    const smoothed = this.filter.filter(rawPxX, rawPxY, timestamp);
    const clampedX = Number.isFinite(smoothed.x) ? Math.max(0, Math.min(viewWidth, smoothed.x)) : rawPxX;
    const clampedY = Number.isFinite(smoothed.y) ? Math.max(0, Math.min(viewHeight, smoothed.y)) : rawPxY;

    this.currentState.x = clampedX;
    this.currentState.y = clampedY;

    // 10. Strict Dwell Gating: NEVER trigger dwell clicks if dwell is not allowed
    if (telemetry.isDwellAllowed !== false && trackingState === 'TRACKING') {
      this.updateDwell(clampedX, clampedY, timestamp);
    } else {
      this.resetDwell();
    }

    // 11. Emit state
    if (this.onUpdate) {
      this.onUpdate(this.currentState);
    }
  }

  private updateDwell(x: number, y: number, timestamp: number): void {
    const dwellRadius = this.profile.dwellRadiusPx;
    const dwellDuration = this.profile.dwellDurationMs;

    if (this.dwellStartTime === null) {
      // Start a new dwell anchor
      this.dwellAnchorX = x;
      this.dwellAnchorY = y;
      this.dwellStartTime = timestamp;
      this.hasTriggeredDwellThisCycle = false;
      this.currentState.dwellProgress = 0;
      this.currentState.isDwelling = false;
      return;
    }

    // Check if still within dwell radius
    const dist = Math.hypot(x - this.dwellAnchorX, y - this.dwellAnchorY);

    if (dist <= dwellRadius) {
      this.currentState.isDwelling = true;
      const elapsed = timestamp - this.dwellStartTime;
      const progress = Math.min(1.0, elapsed / dwellDuration);
      this.currentState.dwellProgress = progress;

      if (progress >= 1.0 && !this.hasTriggeredDwellThisCycle) {
        this.hasTriggeredDwellThisCycle = true;
        if (this.onDwellClick) {
          this.onDwellClick(this.dwellAnchorX, this.dwellAnchorY);
        }
      }
    } else {
      // Drifted outside dwell radius: reset dwell
      this.resetDwell();
      this.dwellAnchorX = x;
      this.dwellAnchorY = y;
      this.dwellStartTime = timestamp;
    }
  }

  public resetDwell(): void {
    this.dwellStartTime = null;
    this.hasTriggeredDwellThisCycle = false;
    this.currentState.dwellProgress = 0;
    this.currentState.isDwelling = false;
  }

  public recenter(newNeutralPose?: { yaw: number; pitch: number }): void {
    if (newNeutralPose) {
      this.profile.neutralPose = { ...newNeutralPose };
    }
    this.filter.reset();
    this.resetDwell();
    const viewWidth = typeof window !== 'undefined' ? window.innerWidth : 1920;
    const viewHeight = typeof window !== 'undefined' ? window.innerHeight : 1080;
    this.currentState.x = viewWidth / 2;
    this.currentState.y = viewHeight / 2;
    this.currentState.rawX = viewWidth / 2;
    this.currentState.rawY = viewHeight / 2;
    if (this.onUpdate) this.onUpdate(this.currentState);
  }
}
