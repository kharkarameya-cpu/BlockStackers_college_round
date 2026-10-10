/**
 * Handsfree Speech Controller
 * Manages Web Speech API listening lifecycle, command parsing, and state transitions.
 */

import { ParsedVoiceCommand } from '../../types/intent';
import { LocalAIEngine } from '../ai/LocalAIEngine';
import { DOMIndexer } from '../semantic/DOMIndexer';
import { AudioLogger } from './AudioLogger';

export type SpeechMode = 'COMMAND' | 'DICTATE';

export interface SpeechControllerCallbacks {
  onCommand?: (command: ParsedVoiceCommand) => void;
  onDictationText?: (text: string) => void;
  onStateChange?: (isListening: boolean, mode: SpeechMode) => void;
  onError?: (error: string) => void;
}

export class SpeechController {
  private recognition: any = null;
  private isListening: boolean = false;
  private mode: SpeechMode = 'COMMAND';
  private callbacks: SpeechControllerCallbacks = {};
  private autoRestart: boolean = false;
  private isSupported: boolean = false;

  private static readonly ORDINAL_MAP: Record<string, number> = {
    first: 0,
    '1st': 0,
    one: 0,
    second: 1,
    '2nd': 1,
    two: 1,
    third: 2,
    '3rd': 2,
    three: 2,
    fourth: 3,
    '4th': 3,
    four: 3,
    fifth: 4,
    '5th': 4,
    five: 4,
    last: -1,
  };

  constructor(callbacks: SpeechControllerCallbacks = {}) {
    this.callbacks = callbacks;
    this.initRecognition();
  }

  private initRecognition(): void {
    if (typeof window === 'undefined') return;

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      this.isSupported = false;
      return;
    }

    this.isSupported = true;
    try {
      this.recognition = new SpeechRecognition();
      this.recognition.continuous = true;
      this.recognition.interimResults = false;
      this.recognition.lang = 'en-US';

      this.recognition.onstart = () => {
        this.isListening = true;
        this.notifyState();
      };

      this.recognition.onend = () => {
        if (this.autoRestart && this.isListening) {
          try {
            this.recognition.start();
          } catch {
            this.isListening = false;
            this.notifyState();
          }
        } else {
          this.isListening = false;
          this.notifyState();
        }
      };

      this.recognition.onerror = (event: any) => {
        if (event.error === 'no-speech') return; // Silence is normal
        const errMsg = event.error || 'Speech recognition error';
        if (this.callbacks.onError) this.callbacks.onError(errMsg);
      };

      this.recognition.onresult = (event: any) => {
        const lastResult = event.results[event.results.length - 1];
        if (!lastResult || !lastResult[0]) return;

        const transcript = lastResult[0].transcript.trim();
        this.processTranscript(transcript);
      };
    } catch (e: any) {
      this.isSupported = false;
      if (this.callbacks.onError) this.callbacks.onError(e.message || 'Speech init failure');
    }
  }

  public start(): boolean {
    if (!this.isSupported || !this.recognition) return false;
    this.autoRestart = true;
    try {
      this.recognition.start();
      return true;
    } catch {
      return false;
    }
  }

  public stop(): void {
    this.autoRestart = false;
    if (this.recognition && this.isListening) {
      try {
        this.recognition.stop();
      } catch {
        // Ignored
      }
    }
    this.isListening = false;
    this.notifyState();
  }

  public setMode(mode: SpeechMode): void {
    this.mode = mode;
    this.notifyState();
  }

  public getMode(): SpeechMode {
    return this.mode;
  }

  public getIsListening(): boolean {
    return this.isListening;
  }

  public getIsSupported(): boolean {
    return this.isSupported;
  }

  /**
   * Parse transcript into structured voice command or text dictation
   */
  public processTranscript(rawTranscript: string): void {
    const text = rawTranscript.trim();
    if (!text) return;

    // Check mode
    if (this.mode === 'DICTATE') {
      const lower = text.toLowerCase();
      if (
        lower === 'stop dictation' ||
        lower === 'stop typing' ||
        lower === 'done typing' ||
        lower === 'finish dictation'
      ) {
        this.setMode('COMMAND');
        if (this.callbacks.onCommand) {
          this.callbacks.onCommand({ type: 'STOP_DICTATION', rawText: text });
        }
        return;
      }

      // In dictation mode: pass raw text to dictation controller
      if (this.callbacks.onDictationText) {
        this.callbacks.onDictationText(text);
      }
      return;
    }

    // In COMMAND mode: check if complex/compound sentence
    if (SpeechController.isComplexSentence(text)) {
      const pageContext = typeof document !== 'undefined' ? DOMIndexer.getCompactPageContext() : undefined;
      LocalAIEngine.getInstance()
        .parseComplexSentence(text, pageContext)
        .then((res) => {
          if (res.actionPlan) {
            this.dispatchCommand({
              type: 'COMPOUND_SEQUENCE',
              rawText: text,
              sequence: res.actions,
              explanation: res.explanation,
              actionPlan: res.actionPlan,
            });
          } else if (res.actions.length === 1) {
            this.dispatchCommand(res.actions[0]);
          } else if (res.actions.length > 1) {
            this.dispatchCommand({
              type: 'COMPOUND_SEQUENCE',
              rawText: text,
              sequence: res.actions,
              explanation: res.explanation,
            });
          } else {
            this.dispatchCommand(SpeechController.parseCommand(text));
          }
        })
        .catch(() => {
          this.dispatchCommand(SpeechController.parseCommand(text));
        });
      return;
    }

    const command = SpeechController.parseCommand(text);
    this.dispatchCommand(command);
  }

  private dispatchCommand(command: ParsedVoiceCommand): void {
    if (command.type === 'START_DICTATION') {
      this.setMode('DICTATE');
    }

    if (this.callbacks.onCommand) {
      this.callbacks.onCommand(command);
    }
  }

  /**
   * Check if utterance contains compound conjunctions or natural complex query
   */
  public static isComplexSentence(text: string): boolean {
    const clean = text.trim();
    const lower = clean.toLowerCase();

    // Check for explicit compound clause delimiters
    if (/\s+(?:and\s+then|after\s+that|then|and|also)\s+/i.test(lower)) return true;
    if (/[;,]/.test(clean)) return true;

    // Check for typed commands: "type hello world", "write email"
    if (/^(?:type|write|enter|input)\s+/i.test(lower)) return true;

    // Check for search requests: "search for shoes", "search flights to mumbai"
    if (/^(?:search\s+for|look\s+up|google)\s+/i.test(lower)) return true;

    return false;
  }

  /**
   * Deterministic finite grammar parser for handsfree commands
   */
  public static parseCommand(text: string): ParsedVoiceCommand {
    const clean = text.trim();
    const lower = clean.toLowerCase();

    // Direct system commands
    if (lower === 'scroll down' || lower.startsWith('scroll down') || lower === 'page down') return { type: 'SCROLL_DOWN', rawText: clean };
    if (lower === 'scroll up' || lower.startsWith('scroll up') || lower === 'page up') return { type: 'SCROLL_UP', rawText: clean };
    if (lower === 'scroll to top' || lower === 'top of page' || lower === 'go to top') return { type: 'SCROLL_TOP', rawText: clean };
    if (lower === 'scroll to bottom' || lower === 'bottom of page' || lower === 'go to bottom') return { type: 'SCROLL_BOTTOM', rawText: clean };

    if (lower === 'go back' || lower === 'back') return { type: 'NAVIGATE_BACK', rawText: clean };
    if (lower === 'go forward' || lower === 'forward') return { type: 'NAVIGATE_FORWARD', rawText: clean };
    if (lower === 'refresh page' || lower === 'reload page' || lower === 'reload') return { type: 'REFRESH_PAGE', rawText: clean };

    if (lower === 'start dictation' || lower === 'start typing' || lower === 'type here') return { type: 'START_DICTATION', rawText: clean };
    if (lower === 'stop dictation' || lower === 'stop typing') return { type: 'STOP_DICTATION', rawText: clean };

    if (lower === 'stop listening' || lower === 'pause voice' || lower === 'mute') return { type: 'STOP_LISTENING', rawText: clean };
    if (lower === 'start listening' || lower === 'resume voice' || lower === 'unmute') return { type: 'START_LISTENING', rawText: clean };

    if (lower === 'cancel' || lower === 'dismiss' || lower === 'close choices') return { type: 'CANCEL', rawText: clean };
    if (lower === 'show choices' || lower === 'choices' || lower === 'show options' || lower === 'show targets') return { type: 'SHOW_CHOICES', rawText: clean };
    if (lower === 'undo that' || lower === 'undo' || lower === 'revert') return { type: 'UNDO', rawText: clean };
    if (lower === 'confirm' || lower === 'yes confirm' || lower === 'proceed') return { type: 'CONFIRM', rawText: clean };

    // Browser navigation & tabs (from Reference Guide)
    if (lower === 'open settings' || lower === 'settings') return { type: 'OPEN_SETTINGS', rawText: clean };
    if (lower === 'new tab' || lower === 'open new tab' || lower === 'open tab') return { type: 'NEW_TAB', rawText: clean };
    if (lower === 'close tab') return { type: 'CLOSE_TAB', rawText: clean };
    if (lower === 'next tab') return { type: 'NEXT_TAB', rawText: clean };
    if (lower === 'previous tab' || lower === 'prev tab') return { type: 'PREVIOUS_TAB', rawText: clean };
    if (lower === 'page up') return { type: 'SCROLL_UP', rawText: clean };
    if (lower === 'page down') return { type: 'SCROLL_DOWN', rawText: clean };
    if (lower === 'teach this phrase' || lower === 'teach alias' || lower === 'learn this phrase') return { type: 'TEACH_ALIAS', rawText: clean };
    if (lower === 'press enter' || lower === 'hit enter' || lower === 'enter') return { type: 'PRESS_ENTER', rawText: clean };

    // Text entry command: "type hello world", "write email"
    const typeMatch = clean.match(/^(?:type|write|enter|input)\s+(.+)$/i);
    if (typeMatch && typeMatch[1]) {
      return {
        type: 'TYPE_TEXT',
        rawText: clean,
        text: typeMatch[1].trim(),
      };
    }

    // Ordinal selection: "open the second result", "choose the first one", "select number 2"
    const ordinalMatch = lower.match(
      /(?:open|click|choose|select|pick)?\s*(?:the)?\s*(first|second|third|fourth|fifth|1st|2nd|3rd|4th|5th|one|two|three|four|five|last)\s*(?:one|result|target|item|choice)?/i
    );
    if (ordinalMatch && ordinalMatch[1] && SpeechController.ORDINAL_MAP[ordinalMatch[1]] !== undefined) {
      return {
        type: 'ORDINAL_SELECT',
        rawText: clean,
        ordinalIndex: SpeechController.ORDINAL_MAP[ordinalMatch[1]],
      };
    }

    // Superlative query: "choose the cheapest option" / "cheapest flight" / "cheapest"
    if (lower.includes('cheapest')) {
      return {
        type: 'CLICK_TARGET',
        rawText: clean,
        targetQuery: 'cheapest',
        superlative: 'CHEAPEST',
      };
    }

    // Focus command: "focus search", "focus email input"
    if (lower.startsWith('focus ') || lower.startsWith('select input ')) {
      const query = clean.replace(/^(focus|select input)\s+/i, '').trim();
      return {
        type: 'FOCUS_INPUT',
        rawText: clean,
        targetQuery: query,
      };
    }

    // Semantic target action: "click login", "open settings", "click on pricing"
    const actionMatch = clean.match(/^(?:click|open|select|press|tap|go to)\s+(?:on\s+)?(.+)$/i);
    if (actionMatch && actionMatch[1]) {
      return {
        type: 'CLICK_TARGET',
        rawText: clean,
        targetQuery: actionMatch[1].trim(),
      };
    }

    // Default fallback: treat spoken noun/phrase as implicit target selection ("login button", "cart")
    return {
      type: 'CLICK_TARGET',
      rawText: clean,
      targetQuery: clean,
    };
  }

  private notifyState(): void {
    if (this.callbacks.onStateChange) {
      this.callbacks.onStateChange(this.isListening, this.mode);
    }
  }
}
