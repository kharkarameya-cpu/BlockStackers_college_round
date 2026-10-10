import { CalibrationProfile, InteractionMode, TrackingTelemetry } from './tracking';
import { PageAccessibilityContext } from './ai';
import { ParsedVoiceCommand } from './intent';

export type MessageType =
  | 'POSE_UPDATE'
  | 'TRACKING_STATUS'
  | 'SET_MODE'
  | 'TOGGLE_PAUSE'
  | 'CALIBRATION_UPDATED'
  | 'REQUEST_CALIBRATION'
  | 'START_TRACKING'
  | 'STOP_TRACKING'
  | 'CLICK_EVENT'
  | 'RECENTER_CURSOR'
  | 'PARSE_COMPLEX_INTENT'
  | 'AI_CONNECTION_TEST'
  | 'TEACH_ALIAS_COMMAND'
  | 'GENERATE_ACTION_PLAN'
  | 'CANCEL_ACTION_PLAN'
  | 'PING'
  | 'PONG'
  | 'AUDIO_LOG_ENTRY'
  | 'GET_AUDIO_LOGS'
  | 'CLEAR_AUDIO_LOGS'
  | 'VOICE_COMMAND_DETECTED'
  | 'EXECUTE_VOICE_COMMAND'
  | 'START_SPEECH'
  | 'STOP_SPEECH';

export interface BaseMessage {
  type: MessageType;
}

export interface PoseUpdateMessage extends BaseMessage {
  type: 'POSE_UPDATE';
  telemetry: TrackingTelemetry;
}

export interface TrackingStatusMessage extends BaseMessage {
  type: 'TRACKING_STATUS';
  isTracking: boolean;
  cameraActive: boolean;
  error?: string;
}

export interface SetModeMessage extends BaseMessage {
  type: 'SET_MODE';
  mode: InteractionMode;
}

export interface TogglePauseMessage extends BaseMessage {
  type: 'TOGGLE_PAUSE';
  paused?: boolean;
}

export interface CalibrationUpdatedMessage extends BaseMessage {
  type: 'CALIBRATION_UPDATED';
  profile: CalibrationProfile;
}

export interface RequestCalibrationMessage extends BaseMessage {
  type: 'REQUEST_CALIBRATION';
}

export interface StartTrackingMessage extends BaseMessage {
  type: 'START_TRACKING';
}

export interface StopTrackingMessage extends BaseMessage {
  type: 'STOP_TRACKING';
}

export interface ClickEventMessage extends BaseMessage {
  type: 'CLICK_EVENT';
  x: number;
  y: number;
  origin: 'DWELL' | 'VOICE';
}

export interface RecenterCursorMessage extends BaseMessage {
  type: 'RECENTER_CURSOR';
}

export interface PingMessage extends BaseMessage {
  type: 'PING';
}

export interface PongMessage extends BaseMessage {
  type: 'PONG';
}

export interface ParseComplexIntentMessage extends BaseMessage {
  type: 'PARSE_COMPLEX_INTENT';
  text: string;
}

export interface AiConnectionTestMessage extends BaseMessage {
  type: 'AI_CONNECTION_TEST';
}

export interface TeachAliasCommandMessage extends BaseMessage {
  type: 'TEACH_ALIAS_COMMAND';
  phrase: string;
  commandType: any;
  targetQuery?: string;
}

export interface GenerateActionPlanMessage extends BaseMessage {
  type: 'GENERATE_ACTION_PLAN';
  instruction: string;
  context?: PageAccessibilityContext;
}

export interface CancelActionPlanMessage extends BaseMessage {
  type: 'CANCEL_ACTION_PLAN';
}

export type AudioLogType =
  | 'TRANSCRIPT'
  | 'COMMAND'
  | 'AI_COMPLEX'
  | 'AI_ACTION_PLAN'
  | 'DICTATION'
  | 'STATUS'
  | 'ERROR'
  | 'EXECUTION';

export type AudioLogLevel = 'info' | 'warn' | 'error' | 'success';

export interface AudioLogEntry {
  id: string;
  timestamp: number;
  type: AudioLogType;
  level: AudioLogLevel;
  text: string;
  details?: any;
  source?: 'content' | 'background' | 'popup' | 'offscreen' | 'diagnostics';
}

export interface AudioLogMessage extends BaseMessage {
  type: 'AUDIO_LOG_ENTRY';
  entry: AudioLogEntry;
}

export interface GetAudioLogsMessage extends BaseMessage {
  type: 'GET_AUDIO_LOGS';
}

export interface ClearAudioLogsMessage extends BaseMessage {
  type: 'CLEAR_AUDIO_LOGS';
}

export interface VoiceCommandDetectedMessage extends BaseMessage {
  type: 'VOICE_COMMAND_DETECTED';
  command: ParsedVoiceCommand;
}

export interface ExecuteVoiceCommandMessage extends BaseMessage {
  type: 'EXECUTE_VOICE_COMMAND';
  command: ParsedVoiceCommand;
}

export interface StartSpeechMessage extends BaseMessage {
  type: 'START_SPEECH';
}

export interface StopSpeechMessage extends BaseMessage {
  type: 'STOP_SPEECH';
}

export type ExtensionMessage =
  | PoseUpdateMessage
  | TrackingStatusMessage
  | SetModeMessage
  | TogglePauseMessage
  | CalibrationUpdatedMessage
  | RequestCalibrationMessage
  | StartTrackingMessage
  | StopTrackingMessage
  | ClickEventMessage
  | RecenterCursorMessage
  | ParseComplexIntentMessage
  | AiConnectionTestMessage
  | TeachAliasCommandMessage
  | GenerateActionPlanMessage
  | CancelActionPlanMessage
  | PingMessage
  | PongMessage
  | AudioLogMessage
  | GetAudioLogsMessage
  | ClearAudioLogsMessage
  | VoiceCommandDetectedMessage
  | ExecuteVoiceCommandMessage
  | StartSpeechMessage
  | StopSpeechMessage;

