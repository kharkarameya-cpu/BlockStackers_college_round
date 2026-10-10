/**
 * Vision and Camera subsystem types for Handsfree
 */

export type CameraStatus =
  | 'IDLE'                   // Waiting for user to explicitly initiate camera setup
  | 'REQUESTING_PERMISSION' // In-progress getUserMedia call
  | 'INITIALIZING_VISION'   // Loading local WASM and FaceLandmarker model
  | 'ACTIVE'                // Camera streaming & vision processing active
  | 'PERMISSION_DENIED'     // User denied camera permission
  | 'DEVICE_DISCONNECTED'   // Camera hardware unplugged or track ended
  | 'ERROR'                 // General camera or vision error
  | 'STOPPED';              // User intentionally stopped the camera

export type TrackingQuality =
  | 'OPTIMAL'       // High confidence, single stable face, good lighting
  | 'DEGRADED'      // Multiple faces in view, extreme angle, or slight jitter
  | 'INSUFFICIENT'  // Low landmark visibility score or partial occlusion
  | 'LOST';         // No face detected in frame

export type TrackingState =
  | 'NO_FACE'
  | 'ACQUIRING'
  | 'TRACKING'
  | 'TEMPORARILY_LOST'
  | 'REACQUIRING';

export type HandGesture =
  | 'POINTING'      // Index finger extended -> moves cursor
  | 'PINCH'         // Thumb + Index together -> click / select
  | 'DOUBLE_PINCH'  // Rapid double pinch -> double-click
  | 'CLOSED_FIST'   // Fist curled -> freeze / stop cursor
  | 'OPEN_PALM'     // All fingers extended -> neutral hover / pause
  | 'TWO_FINGERS'   // Index + Middle extended -> scroll mode
  | 'THREE_FINGERS' // Index + Middle + Ring -> show interactive target labels
  | 'THUMBS_UP'     // Thumb upward -> confirm action
  | 'THUMBS_DOWN'   // Thumb downward -> cancel action
  | 'UNKNOWN';

export type Handedness = 'Left' | 'Right';

export interface HandLandmark {
  x: number;
  y: number;
  z: number;
}

export interface HandBoundingBox {
  xMin: number;
  yMin: number;
  width: number;
  height: number;
}

export interface DetectedHand {
  handedness: Handedness;
  score: number;
  landmarks: HandLandmark[];
  gesture: HandGesture;
  pinchDistance: number;
  isPinching: boolean;
  cursorNormalizedX: number; // 0..1 (mirrored for natural interaction)
  cursorNormalizedY: number; // 0..1
  boundingBox: HandBoundingBox;
}

export interface FaceBoundingBox {
  xMin: number;
  yMin: number;
  width: number;
  height: number;
}

export type DetectorStatus =
  | 'UNINITIALIZED'
  | 'LOADING'
  | 'READY'
  | 'TRACKING'
  | 'NOT_VISIBLE'
  | 'ERROR'
  | 'DISABLED';

export type TrackingMode = 'HYBRID' | 'HAND_ONLY' | 'HEAD_ONLY';

export type ActiveTrackingSource = 'HAND' | 'FACE' | 'NONE';

export interface TrackingResult {
  /** High-resolution timestamp in milliseconds */
  timestamp: number;

  /** Discrete tracking state machine status */
  trackingState?: TrackingState;

  /** Independent face detector status */
  faceStatus?: DetectorStatus;

  /** Independent hand detector status */
  handStatus?: DetectorStatus;

  /** Independent error messages if either detector failed */
  faceError?: string | null;
  handError?: string | null;

  /** Age / timestamp of last successful detection */
  lastFaceDetectionTime?: number;
  lastHandDetectionTime?: number;

  /** Current active source controlling cursor */
  activeSource?: ActiveTrackingSource;

  /** Normalized horizontal position (-1.0 to 1.0, 0 is neutral center) */
  normalizedX: number;

  /** Normalized vertical position (-1.0 to 1.0, 0 is neutral center) */
  normalizedY: number;

  /** Direct viewport-normalized cursor position [0, 1] (mirrored for natural interaction) */
  cursorNormalizedX?: number;
  cursorNormalizedY?: number;

  /** Normalized yaw / lateral movement */
  yaw: number;

  /** Normalized pitch / vertical movement */
  pitch: number;

  /** Normalized roll */
  roll: number;

  /**
   * Tracking confidence score (0.0 to 1.0).
   */
  confidence: number;

  /** Discrete tracking quality classification */
  quality: TrackingQuality;

  /** Whether face is detected in the frame */
  faceDetected: boolean;

  /** Whether at least one hand is detected in the frame */
  handDetected: boolean;

  /** Number of hands detected in the frame (0, 1, or 2) */
  handsDetected: number;

  /** List of detected hands (supports both hands) */
  hands: DetectedHand[];

  /** Primary active hand controlling cursor */
  activeHand: DetectedHand | null;

  /** Primary active discrete hand gesture */
  activeGesture: HandGesture;

  /** Legacy alias for multiple faces or hands detected */
  multipleFacesDetected: boolean;

  /** Number of landmarks extracted from the active subject */
  landmarksCount: number;

  /** Raw face landmarks if face was detected */
  faceLandmarks?: any[];

  /** Bounding box of the primary tracked subject in normalized coordinates [0, 1] */
  boundingBox?: FaceBoundingBox;
}

export interface CameraDiagnosticMetrics {
  fps: number;
  frameLatencyMs: number;
  status: CameraStatus;
  errorMessage: string | null;
  videoWidth: number;
  videoHeight: number;
  faceStatus?: DetectorStatus;
  handStatus?: DetectorStatus;
  faceError?: string | null;
  handError?: string | null;
  activeSource?: ActiveTrackingSource;
}

