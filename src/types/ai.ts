import { ParsedVoiceCommand, VoiceCommandType } from './intent';

export type AIProvider = 'OLLAMA' | 'OPENAI_COMPATIBLE' | 'CHROME_AI' | 'HYBRID_RULE';

export interface LocalAIConfig {
  enabled: boolean;
  provider: AIProvider;
  endpoint: string;
  model: string;
  temperature: number;
  maxTokens: number;
  timeoutMs?: number;
}

export const DEFAULT_LOCAL_AI_CONFIG: LocalAIConfig = {
  enabled: true,
  provider: 'OLLAMA',
  endpoint: 'http://localhost:11434',
  model: 'qwen2.5:1.5b',
  temperature: 0.1,
  maxTokens: 512,
  timeoutMs: 8000,
};

export type ActionPlanStatus =
  | 'ready'
  | 'clarification_required'
  | 'unsupported'
  | 'page_inspection_required';

export type RegisteredActionType =
  | 'navigate'
  | 'click'
  | 'fill'
  | 'press_key'
  | 'scroll'
  | 'select'
  | 'wait'
  | 'extract_text'
  | 'compare_items'
  | 'go_back'
  | 'clarify';

export interface ActionTarget {
  role?: string;
  name?: string;
  text?: string;
  id?: string;
  ordinalIndex?: number;
}

export interface NavigateStep {
  action: 'navigate';
  url: string;
}

export interface ClickStep {
  action: 'click';
  target: ActionTarget;
}

export interface FillStep {
  action: 'fill';
  target: ActionTarget;
  text: string;
}

export interface PressKeyStep {
  action: 'press_key';
  key: string;
}

export interface ScrollStep {
  action: 'scroll';
  direction: 'up' | 'down' | 'top' | 'bottom';
  amount?: number;
}

export interface SelectStep {
  action: 'select';
  target: ActionTarget;
  option: string;
}

export interface WaitStep {
  action: 'wait';
  durationMs: number;
}

export interface ExtractTextStep {
  action: 'extract_text';
  target?: ActionTarget;
  query?: string;
}

export interface CompareItemsStep {
  action: 'compare_items';
  items: string[];
}

export interface GoBackStep {
  action: 'go_back';
}

export interface ClarifyStep {
  action: 'clarify';
  question: string;
}

export type ActionPlanStep =
  | NavigateStep
  | ClickStep
  | FillStep
  | PressKeyStep
  | ScrollStep
  | SelectStep
  | WaitStep
  | ExtractTextStep
  | CompareItemsStep
  | GoBackStep
  | ClarifyStep;

export interface ActionPlan {
  status: ActionPlanStatus;
  reason: string;
  steps: ActionPlanStep[];
  requires_confirmation: boolean;
  clarification_question: string | null;
}

export interface CompactElementInfo {
  id: string;
  tagName: string;
  role: string;
  accessibleName: string;
  placeholder?: string;
  inputType?: string;
  isConsequential?: boolean;
  price?: number;
}

export interface PageAccessibilityContext {
  url: string;
  title: string;
  headings: string[];
  interactiveElements: CompactElementInfo[];
  productContext?: { title?: string; price?: number }[];
  forms?: { name?: string; fields: string[] }[];
}

export interface CommandAlias {
  id: string;
  phrase: string;
  normalizedPhrase: string;
  commandType: VoiceCommandType;
  targetQuery?: string;
  text?: string;
  createdAt: number;
  updatedAt: number;
  usageCount: number;
}

export interface LearnedIntentExemplar {
  id: string;
  rawSentence: string;
  normalizedSentence: string;
  actions: ParsedVoiceCommand[];
  confidence: number;
  timesUsed: number;
  timesUndone: number;
  source: 'LLM_DECOMPOSED' | 'USER_CORRECTION' | 'TEACH_ALIAS' | 'HEURISTIC';
  createdAt: number;
  lastUsedAt: number;
}

export interface ComplexParseResult {
  actions: ParsedVoiceCommand[];
  actionPlan?: ActionPlan;
  confidence: number;
  source: 'EXACT_ALIAS' | 'LEARNED_EXEMPLAR' | 'LOCAL_QWEN' | 'HYBRID_RULE';
  explanation: string;
  latencyMs: number;
}

