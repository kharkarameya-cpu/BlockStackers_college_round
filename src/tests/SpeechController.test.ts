import { describe, it, expect } from 'vitest';
import { SpeechController } from '../core/speech/SpeechController';

describe('SpeechController - Command Parser', () => {
  it('parses directional scroll commands', () => {
    expect(SpeechController.parseCommand('scroll down').type).toBe('SCROLL_DOWN');
    expect(SpeechController.parseCommand('scroll up').type).toBe('SCROLL_UP');
    expect(SpeechController.parseCommand('scroll to top').type).toBe('SCROLL_TOP');
    expect(SpeechController.parseCommand('scroll to bottom').type).toBe('SCROLL_BOTTOM');
  });

  it('parses browser navigation commands', () => {
    expect(SpeechController.parseCommand('go back').type).toBe('NAVIGATE_BACK');
    expect(SpeechController.parseCommand('go forward').type).toBe('NAVIGATE_FORWARD');
    expect(SpeechController.parseCommand('refresh page').type).toBe('REFRESH_PAGE');
  });

  it('parses dictation control commands', () => {
    expect(SpeechController.parseCommand('start dictation').type).toBe('START_DICTATION');
    expect(SpeechController.parseCommand('stop dictation').type).toBe('STOP_DICTATION');
  });

  it('parses ordinal selection queries', () => {
    const first = SpeechController.parseCommand('open the first result');
    expect(first.type).toBe('ORDINAL_SELECT');
    expect(first.ordinalIndex).toBe(0);

    const second = SpeechController.parseCommand('click the second one');
    expect(second.type).toBe('ORDINAL_SELECT');
    expect(second.ordinalIndex).toBe(1);

    const third = SpeechController.parseCommand('choose the 3rd item');
    expect(third.type).toBe('ORDINAL_SELECT');
    expect(third.ordinalIndex).toBe(2);

    const last = SpeechController.parseCommand('select the last option');
    expect(last.type).toBe('ORDINAL_SELECT');
    expect(last.ordinalIndex).toBe(-1);
  });

  it('parses price-based superlative queries', () => {
    const cmd = SpeechController.parseCommand('choose the cheapest option');
    expect(cmd.type).toBe('CLICK_TARGET');
    expect(cmd.superlative).toBe('CHEAPEST');
  });

  it('parses input focus commands', () => {
    const cmd = SpeechController.parseCommand('focus search');
    expect(cmd.type).toBe('FOCUS_INPUT');
    expect(cmd.targetQuery).toBe('search');
  });

  it('parses semantic target action commands', () => {
    const cmd = SpeechController.parseCommand('click Login button');
    expect(cmd.type).toBe('CLICK_TARGET');
    expect(cmd.targetQuery).toBe('Login button');
  });

  it('parses safety, confirmation, and recovery commands', () => {
    expect(SpeechController.parseCommand('undo that').type).toBe('UNDO');
    expect(SpeechController.parseCommand('cancel').type).toBe('CANCEL');
    expect(SpeechController.parseCommand('confirm').type).toBe('CONFIRM');
    expect(SpeechController.parseCommand('show choices').type).toBe('SHOW_CHOICES');
  });
});
