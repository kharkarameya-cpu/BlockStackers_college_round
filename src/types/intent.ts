/**
 * Handsfree Intent, Semantic, and Speech Types
 */


export type ActionRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH';

export interface ActionableElement {
  id: string; // Unique runtime identifier (e.g. "hf-el-42")
  element: HTMLElement;
  tagName: string;
  role: string;
  accessibleName: string;
  ariaLabel: string;
  visibleText: string;
  containerContext?: string;
  rect: DOMRect;
  centerX: number;
  centerY: number;
  price?: number; // Extracted monetary value if present (e.g. $19.99)
  isConsequential: boolean;
  isDisabled: boolean;
}

export interface SemanticMatch {
  candidate: ActionableElement;
  score: number; // 0.0 to 1.0
  matchType: 'EXACT' | 'FUZZY' | 'ORDINAL' | 'SUPERLATIVE' | 'CONTEXTUAL';
  explanation: string;
}

export type VoiceCommandType =
  | 'SCROLL_UP'
  | 'SCROLL_DOWN'
  | 'SCROLL_TOP'
  | 'SCROLL_BOTTOM'
  | 'NAVIGATE_BACK'
  | 'NAVIGATE_FORWARD'
  | 'REFRESH_PAGE'
  | 'CLICK'
  | 'DOUBLE_CLICK'
  | 'RECENTER_CURSOR'
  | 'CLICK_TARGET'
  | 'ORDINAL_SELECT'
  | 'FOCUS_INPUT'
  | 'TYPE_TEXT'
  | 'PRESS_ENTER'
  | 'NEW_TAB'
  | 'CLOSE_TAB'
  | 'NEXT_TAB'
  | 'PREVIOUS_TAB'
  | 'OPEN_SETTINGS'
  | 'START_DICTATION'
  | 'STOP_DICTATION'
  | 'STOP_LISTENING'
  | 'START_LISTENING'
  | 'CANCEL'
  | 'SHOW_CHOICES'
  | 'UNDO'
  | 'CONFIRM'
  | 'TEACH_ALIAS'
  | 'COMPOUND_SEQUENCE'
  | 'UNKNOWN';

export interface ParsedVoiceCommand {
  type: VoiceCommandType;
  rawText: string;
  targetQuery?: string;
  text?: string;
  ordinalIndex?: number; // 0-based index for "first", "second", etc.
  superlative?: 'CHEAPEST' | 'FIRST' | 'LAST';
  sequence?: ParsedVoiceCommand[];
  aliasPhrase?: string;
  explanation?: string;
  actionPlan?: any;
}

export type FusionOutcome = 'EXECUTE' | 'CLARIFY' | 'CONFIRM' | 'REJECT' | 'PAUSE';

export interface IntentDecision {
  outcome: FusionOutcome;
  target?: ActionableElement;
  candidates?: SemanticMatch[];
  command?: ParsedVoiceCommand;
  riskLevel: ActionRiskLevel;
  confidence: number;
  reason: string;
}

export interface ShadowHypothesis {
  target: ActionableElement;
  createdTimestamp: number;
  expiryTimestamp: number;
  source: 'CURSOR_HOVER' | 'VOICE_CANDIDATE' | 'RECENT_CLICK';
}

export interface ReversibleAction {
  id: string;
  type: 'SCROLL' | 'TEXT_INPUT' | 'FOCUS' | 'NAVIGATION';
  timestamp: number;
  targetElement?: HTMLElement;
  previousValue?: any;
  undo: () => Promise<boolean> | boolean;
  description: string;
}

export interface BenchmarkMetrics {
  totalTasksAttempted: number;
  totalTasksCompleted: number;
  taskCompletionRate: number;
  averageTaskTimeMs: number;
  unintendedActivationsPer100: number;
  semanticAccuracyRate: number;
  recoverySuccessRate: number;
  averageLatencyMs: number;
  dwellSelectionCount: number;
  voiceCommandCount: number;
  undoCount: number;
}
