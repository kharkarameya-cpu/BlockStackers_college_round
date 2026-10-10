/**
 * Handsfree Audio Message Logger
 * Centralized logging system for capturing, broadcasting, and displaying
 * real-time speech recognition transcripts, parsed voice commands, AI plans, and audio events.
 */

import { AudioLogEntry, AudioLogType, AudioLogLevel } from '../../types/messages';

export type AudioLogSubscriber = (entry: AudioLogEntry, allEntries: AudioLogEntry[]) => void;

export class AudioLogger {
  private static instance: AudioLogger | null = null;
  private entries: AudioLogEntry[] = [];
  private subscribers: Set<AudioLogSubscriber> = new Set();
  private maxEntries: number = 200;
  private storageSaveTimeout: any = null;
  private contextName: 'content' | 'background' | 'popup' | 'offscreen' | 'diagnostics' = 'content';

  private constructor() {
    this.detectContext();
    this.loadPersistedLogs();
    this.listenToRuntimeMessages();
  }

  public static getInstance(): AudioLogger {
    if (!AudioLogger.instance) {
      AudioLogger.instance = new AudioLogger();
    }
    return AudioLogger.instance;
  }

  /**
   * Reset instance (mainly for unit tests)
   */
  public static resetInstance(): void {
    if (AudioLogger.instance) {
      AudioLogger.instance.subscribers.clear();
      AudioLogger.instance.entries = [];
      AudioLogger.instance = null;
    }
  }

  private detectContext(): void {
    if (typeof window === 'undefined') {
      this.contextName = 'background';
      return;
    }
    const path = window.location.pathname || '';
    if (path.includes('popup')) this.contextName = 'popup';
    else if (path.includes('diagnostics')) this.contextName = 'diagnostics';
    else if (path.includes('offscreen')) this.contextName = 'offscreen';
    else this.contextName = 'content';
  }

  private loadPersistedLogs(): void {
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      try {
        chrome.storage.local.get(['handsfree_audio_logs'], (res) => {
          if (res && Array.isArray(res.handsfree_audio_logs)) {
            // Merge existing without duplicating IDs
            const existingIds = new Set(this.entries.map((e) => e.id));
            const newEntries = res.handsfree_audio_logs.filter((e: AudioLogEntry) => !existingIds.has(e.id));
            this.entries = [...newEntries, ...this.entries]
              .sort((a, b) => a.timestamp - b.timestamp)
              .slice(-this.maxEntries);
            this.notifySubscribers(this.entries[this.entries.length - 1]);
          }
        });
      } catch {
        // Storage access not available
      }
    }
  }

  private listenToRuntimeMessages(): void {
    if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener((message: any) => {
        if (message && message.type === 'AUDIO_LOG_ENTRY' && message.entry) {
          const entry = message.entry as AudioLogEntry;
          if (!this.entries.some((e) => e.id === entry.id)) {
            this.entries.push(entry);
            if (this.entries.length > this.maxEntries) {
              this.entries.shift();
            }
            this.notifySubscribers(entry);
          }
        } else if (message && message.type === 'CLEAR_AUDIO_LOGS') {
          this.entries = [];
          this.notifySubscribers({
            id: `sys-${Date.now()}`,
            timestamp: Date.now(),
            type: 'STATUS',
            level: 'info',
            text: 'Audio message logs cleared',
          });
        }
      });
    }
  }

  /**
   * Log a generic audio message
   */
  public log(
    type: AudioLogType,
    text: string,
    details?: any,
    level: AudioLogLevel = 'info',
    source?: AudioLogEntry['source']
  ): AudioLogEntry {
    const entry: AudioLogEntry = {
      id: `audio-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      timestamp: Date.now(),
      type,
      level,
      text,
      details,
      source: source || this.contextName,
    };

    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }

    this.printToConsole(entry);
    this.broadcastRuntime(entry);
    this.scheduleStorageSave();
    this.notifySubscribers(entry);

    return entry;
  }

  /**
   * Log raw speech transcript
   */
  public logTranscript(rawTranscript: string, isFinal: boolean = true, confidence?: number): AudioLogEntry {
    const text = rawTranscript.trim();
    return this.log(
      'TRANSCRIPT',
      text ? `🎙️ "${text}"` : '🎙️ (empty transcript)',
      { rawTranscript: text, isFinal, confidence },
      'info'
    );
  }

  /**
   * Log parsed voice command
   */
  public logCommand(command: any, rawText?: string): AudioLogEntry {
    const cmdType = command?.type || 'UNKNOWN';
    const target = command?.targetQuery || command?.ordinalIndex !== undefined ? ` (target: ${command.targetQuery ?? command.ordinalIndex})` : '';
    return this.log(
      'COMMAND',
      `⚡ Parsed Command: ${cmdType}${target}`,
      { command, rawText },
      'success'
    );
  }

  /**
   * Log complex sentence detected for AI reasoning
   */
  public logComplexSentence(text: string, reason?: string): AudioLogEntry {
    return this.log(
      'AI_COMPLEX',
      `🧠 Complex Query: "${text}"`,
      { text, reason },
      'info'
    );
  }

  /**
   * Log AI action plan / sequence generated
   */
  public logAiActionPlan(instruction: string, actions: any[], explanation?: string): AudioLogEntry {
    return this.log(
      'AI_ACTION_PLAN',
      `🤖 AI Plan Generated (${actions.length} action${actions.length === 1 ? '' : 's'})`,
      { instruction, actions, explanation },
      'success'
    );
  }

  /**
   * Log dictated text
   */
  public logDictation(text: string): AudioLogEntry {
    return this.log(
      'DICTATION',
      `✍️ Dictation: "${text}"`,
      { text },
      'info'
    );
  }

  /**
   * Log audio state transition (e.g. listening started, stopped, mode switched)
   */
  public logStatus(text: string, details?: any, level: AudioLogLevel = 'info'): AudioLogEntry {
    return this.log('STATUS', `ℹ️ ${text}`, details, level);
  }

  /**
   * Log execution of a voice command on the page
   */
  public logExecution(commandType: string, success: boolean, details?: any): AudioLogEntry {
    return this.log(
      'EXECUTION',
      success ? `✅ Executed ${commandType}` : `❌ Failed to execute ${commandType}`,
      details,
      success ? 'success' : 'error'
    );
  }

  /**
   * Log speech recognition error
   */
  public logError(errorMessage: string, details?: any): AudioLogEntry {
    return this.log(
      'ERROR',
      `⚠️ Speech Error: ${errorMessage}`,
      details,
      'error'
    );
  }

  /**
   * Styled console print
   */
  private printToConsole(entry: AudioLogEntry): void {
    if (typeof console === 'undefined') return;

    const styles: Record<AudioLogType, { bg: string; fg: string }> = {
      TRANSCRIPT: { bg: '#1d4ed8', fg: '#ffffff' },
      COMMAND: { bg: '#047857', fg: '#ffffff' },
      AI_COMPLEX: { bg: '#6d28d9', fg: '#ffffff' },
      AI_ACTION_PLAN: { bg: '#7e22ce', fg: '#ffffff' },
      DICTATION: { bg: '#b45309', fg: '#ffffff' },
      STATUS: { bg: '#334155', fg: '#ffffff' },
      ERROR: { bg: '#b91c1c', fg: '#ffffff' },
      EXECUTION: { bg: '#0f766e', fg: '#ffffff' },
    };

    const s = styles[entry.type] || { bg: '#334155', fg: '#ffffff' };
    const badge = `%c[Handsfree Audio 🎙️]%c [${entry.type}]`;
    const badgeStyle1 = 'background: #0f172a; color: #38bdf8; font-weight: bold; padding: 2px 5px; border-radius: 3px;';
    const badgeStyle2 = `background: ${s.bg}; color: ${s.fg}; font-weight: bold; padding: 2px 5px; border-radius: 3px; margin-left: 4px;`;

    if (entry.level === 'error') {
      console.error(badge, badgeStyle1, badgeStyle2, entry.text, entry.details || '');
    } else if (entry.level === 'warn') {
      console.warn(badge, badgeStyle1, badgeStyle2, entry.text, entry.details || '');
    } else {
      console.log(badge, badgeStyle1, badgeStyle2, entry.text, entry.details || '');
    }
  }

  /**
   * Broadcast message across Chrome MV3 runtime
   */
  private broadcastRuntime(entry: AudioLogEntry): void {
    if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
      try {
        chrome.runtime.sendMessage({ type: 'AUDIO_LOG_ENTRY', entry }).catch(() => {
          // No active receiver tab/popup, ignored
        });
      } catch {
        // Ignored
      }
    }
  }

  /**
   * Debounced persistence to chrome.storage.local
   */
  private scheduleStorageSave(): void {
    if (typeof chrome === 'undefined' || !chrome.storage?.local) return;

    if (this.storageSaveTimeout) clearTimeout(this.storageSaveTimeout);
    this.storageSaveTimeout = setTimeout(() => {
      try {
        chrome.storage.local.set({ handsfree_audio_logs: this.entries }).catch(() => {});
      } catch {
        // Ignored
      }
    }, 400);
  }

  /**
   * Subscribe to log updates
   */
  public subscribe(subscriber: AudioLogSubscriber): () => void {
    this.subscribers.add(subscriber);
    return () => {
      this.subscribers.delete(subscriber);
    };
  }

  private notifySubscribers(entry?: AudioLogEntry): void {
    const last = entry || this.entries[this.entries.length - 1];
    if (!last) return;
    this.subscribers.forEach((cb) => {
      try {
        cb(last, [...this.entries]);
      } catch (e) {
        console.error('[AudioLogger] Error notifying subscriber:', e);
      }
    });
  }

  /**
   * Retrieve all current log entries
   */
  public getLogs(): AudioLogEntry[] {
    return [...this.entries];
  }

  /**
   * Clear all audio logs
   */
  public clearLogs(): void {
    this.entries = [];
    if (typeof chrome !== 'undefined' && chrome.storage?.local) {
      try {
        chrome.storage.local.remove(['handsfree_audio_logs']).catch(() => {});
        chrome.runtime?.sendMessage?.({ type: 'CLEAR_AUDIO_LOGS' }).catch(() => {});
      } catch {
        // Ignored
      }
    }
    this.notifySubscribers({
      id: `sys-${Date.now()}`,
      timestamp: Date.now(),
      type: 'STATUS',
      level: 'info',
      text: 'Audio message logs cleared',
    });
  }

  /**
   * Export logs as formatted JSON string
   */
  public exportLogs(): string {
    return JSON.stringify(this.entries, null, 2);
  }
}
