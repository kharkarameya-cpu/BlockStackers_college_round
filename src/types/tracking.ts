import { TrackingState, HandGesture, DetectedHand, DetectorStatus, ActiveTrackingSource, TrackingMode } from './vision';

export interface HeadPose {
  /** Normalized horizontal rotation or hand X (-1.0 to 1.0, 0 is neutral) */
  yaw: number;
  /** Normalized vertical rotation or hand Y (-1.0 to 1.0, 0 is neutral) */
  pitch: number;
  /** Normalized tilt (-1.0 to 1.0, 0 is neutral) */
  roll: number;
  /** Detection and tracking confidence score (0.0 to 1.0) */
  confidence: number;
  /** Whether tracking target is currently detected in frame */
  faceDetected: boolean;
  /** Timestamp in milliseconds */
  timestamp: number;
}

export interface TrackingTelemetry {
  pose: HeadPose;
  /** Uncertainty radius in pixels (for Uncertainty Lens) */
  uncertaintyRadius: number;
  /** True when confidence exceeds threshold and jitter is within bounds */
  isTrackingStable: boolean;
  /** True when tracking target lost or confidence dropped below pause threshold */
  trackingLost: boolean;
  /** Optional discrete state machine classification */
  trackingState?: TrackingState;
  /** Whether dwell clicking is currently allowed by the safety state machine */
  isDwellAllowed?: boolean;

  /** Hand tracking & gesture details */
  handDetected?: boolean;
  handsCount?: number;
  activeGesture?: HandGesture;
  hands?: DetectedHand[];
  cursorNormalizedX?: number; // 0..1 in viewport (mirrored)
  cursorNormalizedY?: number; // 0..1 in viewport
  isPinching?: boolean;

  /** Independent face & hand status */
  faceDetected?: boolean;
  faceStatus?: DetectorStatus;
  handStatus?: DetectorStatus;
  faceError?: string | null;
  handError?: string | null;
  activeSource?: ActiveTrackingSource;
  lastFaceDetectionAgeMs?: number;
  lastHandDetectionAgeMs?: number;
}


export interface OneEuroParams {
  /** Minimum cutoff frequency in Hz (prevents jitter at low speeds) */
  minCutoff: number;
  /** Speed coefficient (reduces lag at high speeds) */
  beta: number;
  /** Derivative cutoff frequency */
  dCutoff: number;
}

export interface CalibrationProfile {
  neutralPose: { yaw: number; pitch: number };
  rangeX: { min: number; max: number };
  rangeY: { min: number; max: number };
  deadZoneRadius: number;
  sensitivity: { x: number; y: number };
  invertX: boolean;
  invertY: boolean;
  dwellDurationMs: number;
  dwellRadiusPx: number;
  updatedAt: number;
}

export type InteractionMode =
  | 'PAUSED'
  | 'NAVIGATE'
  | 'POINT'
  | 'LISTEN'
  | 'DICTATE'
  | 'SCROLL'
  | 'CLARIFY'
  | 'CONFIRM';

export const DEFAULT_CALIBRATION_PROFILE: CalibrationProfile = {
  neutralPose: { yaw: 0, pitch: 0 },
  rangeX: { min: -0.28, max: 0.28 },
  rangeY: { min: -0.20, max: 0.20 },
  deadZoneRadius: 0.02,
  sensitivity: { x: 1.25, y: 1.25 },
  invertX: false,
  invertY: false,
  dwellDurationMs: 1200,
  dwellRadiusPx: 28,
  updatedAt: Date.now(),
};

export const DEFAULT_ONE_EURO_PARAMS: OneEuroParams = {
  minCutoff: 1.0,
  beta: 0.007,
  dCutoff: 1.0,
};
