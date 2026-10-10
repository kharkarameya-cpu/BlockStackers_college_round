import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AudioLogger } from '../core/speech/AudioLogger';

describe('Handsfree AudioLogger Service', () => {
  beforeEach(() => {
    AudioLogger.resetInstance();
    // Mock chrome APIs
    (globalThis as any).chrome = {
      runtime: {
        sendMessage: vi.fn().mockResolvedValue(undefined),
        onMessage: {
          addListener: vi.fn(),
        },
      },
      storage: {
        local: {
          get: vi.fn().mockImplementation((_keys, cb) => cb({})),
          set: vi.fn().mockResolvedValue(undefined),
          remove: vi.fn().mockResolvedValue(undefined),
        },
      },
    };
  });

  it('records raw speech transcripts and notifies subscribers', () => {
    const logger = AudioLogger.getInstance();
    let receivedEntry: any = null;

    const unsubscribe = logger.subscribe((entry) => {
      receivedEntry = entry;
    });

    const entry = logger.logTranscript('scroll down quickly', true, 0.95);

    expect(entry).toBeDefined();
    expect(entry.type).toBe('TRANSCRIPT');
    expect(entry.text).toContain('scroll down quickly');
    expect(entry.details.isFinal).toBe(true);
    expect(entry.details.confidence).toBe(0.95);
    expect(receivedEntry).toEqual(entry);

    unsubscribe();
  });

  it('records parsed commands with structured payload', () => {
    const logger = AudioLogger.getInstance();
    const cmd = { type: 'CLICK', targetQuery: 'Login button' };

    const entry = logger.logCommand(cmd, 'click login button');

    expect(entry.type).toBe('COMMAND');
    expect(entry.level).toBe('success');
    expect(entry.text).toContain('CLICK');
    expect(entry.text).toContain('Login button');
    expect(entry.details.command).toEqual(cmd);
    expect(entry.details.rawText).toBe('click login button');
  });

  it('records complex queries and AI action plans', () => {
    const logger = AudioLogger.getInstance();

    const complexEntry = logger.logComplexSentence(
      'search for running shoes and open first result',
      'Conjunction detected'
    );
    expect(complexEntry.type).toBe('AI_COMPLEX');
    expect(complexEntry.text).toContain('search for running shoes');

    const actions = [
      { type: 'FOCUS_SEARCH', targetQuery: 'running shoes' },
      { type: 'TYPE_TEXT', textToType: 'running shoes' },
      { type: 'PRESS_ENTER' },
    ];
    const planEntry = logger.logAiActionPlan('search for running shoes and open first result', actions, 'Decomposed query');
    expect(planEntry.type).toBe('AI_ACTION_PLAN');
    expect(planEntry.details.actions.length).toBe(3);
    expect(planEntry.text).toContain('3 actions');
  });

  it('records dictation text and speech recognition errors', () => {
    const logger = AudioLogger.getInstance();

    const dictEntry = logger.logDictation('Hello, this is handsfree browsing');
    expect(dictEntry.type).toBe('DICTATION');
    expect(dictEntry.text).toContain('Hello, this is handsfree browsing');

    const errEntry = logger.logError('not-allowed: Microphone permission denied', { code: 'not-allowed' });
    expect(errEntry.type).toBe('ERROR');
    expect(errEntry.level).toBe('error');
    expect(errEntry.text).toContain('Microphone permission denied');
  });

  it('enforces ring buffer max capacity to prevent unbounded memory growth', () => {
    const logger = AudioLogger.getInstance();

    // Log 250 messages (max capacity is 200)
    for (let i = 0; i < 250; i++) {
      logger.logStatus(`Event message #${i}`);
    }

    const logs = logger.getLogs();
    expect(logs.length).toBe(200);
    expect(logs[logs.length - 1].text).toContain('#249');
    expect(logs[0].text).toContain('#50');
  });

  it('clears logs and exports formatted JSON string', () => {
    const logger = AudioLogger.getInstance();
    logger.logTranscript('sample text');
    logger.logCommand({ type: 'SCROLL_DOWN' });

    expect(logger.getLogs().length).toBe(2);

    const exported = logger.exportLogs();
    expect(typeof exported).toBe('string');
    const parsed = JSON.parse(exported);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(2);

    logger.clearLogs();
    // After clear, only the status confirmation entry should remain or empty
    const remaining = logger.getLogs();
    expect(remaining.length).toBeLessThanOrEqual(1);
    if (remaining.length === 1) {
      expect(remaining[0].text).toContain('cleared');
    }
  });

  it('broadcasts new log entries via chrome.runtime.sendMessage', () => {
    const logger = AudioLogger.getInstance();
    const entry = logger.logStatus('Web Speech API started');

    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'AUDIO_LOG_ENTRY',
        entry,
      })
    );
  });
});
