import { describe, it, expect, beforeEach } from 'vitest';
import { IntentLearningEngine } from '../core/ai/IntentLearningEngine';

describe('IntentLearningEngine - Adaptive Memory & Accent Learning', () => {
  let engine: IntentLearningEngine;

  beforeEach(async () => {
    engine = IntentLearningEngine.getInstance();
    // Clear in-memory collections for isolated testing
    const exemplars = engine.getExemplars();
    exemplars.length = 0;
    const aliases = engine.getAliases();
    aliases.length = 0;
  });

  it('normalizes speech input consistently by stripping punctuation and lowercasing', () => {
    expect(IntentLearningEngine.normalize('Scroll Down, Please!')).toBe('scroll down please');
    expect(IntentLearningEngine.normalize('  Search for "best laptops"  ')).toBe('search for best laptops');
  });

  it('teaches and resolves exact personal command aliases', async () => {
    await engine.teachAlias('school down', 'SCROLL_DOWN');
    const resolved = engine.resolveExactAlias('school down');
    expect(resolved).not.toBeNull();
    expect(resolved?.type).toBe('SCROLL_DOWN');
    expect(resolved?.aliasPhrase).toBe('school down');
  });

  it('records successful execution and stores learned exemplars', async () => {
    const raw = 'scroll down and click pricing';
    const actions = [
      { type: 'SCROLL_DOWN' as const, rawText: 'scroll down' },
      { type: 'CLICK_TARGET' as const, rawText: 'click pricing', targetQuery: 'pricing' },
    ];

    await engine.recordSuccess(raw, actions);

    const match = engine.findLearnedExemplar(raw);
    expect(match).not.toBeNull();
    expect(match?.actions).toHaveLength(2);
    expect(match?.actions[0].type).toBe('SCROLL_DOWN');
    expect(match?.actions[1].type).toBe('CLICK_TARGET');
  });

  it('matches fuzzy variations of learned exemplars using token similarity', async () => {
    await engine.recordSuccess('search for hotels in Mumbai and press enter', [
      { type: 'FOCUS_INPUT', rawText: 'search', targetQuery: 'search' },
      { type: 'TYPE_TEXT', rawText: 'hotels in Mumbai', text: 'hotels in Mumbai' },
      { type: 'PRESS_ENTER', rawText: 'press enter' },
    ]);

    // Spoken with slight word order / noise
    const fuzzyMatch = engine.findLearnedExemplar('search for hotels in Mumbai and hit enter', 0.75);
    expect(fuzzyMatch).not.toBeNull();
    expect(fuzzyMatch?.actions).toHaveLength(3);
  });

  it('penalizes and lowers confidence on user Undo feedback', async () => {
    const phrase = 'take me to the cart page';
    await engine.recordSuccess(phrase, [
      { type: 'CLICK_TARGET', rawText: phrase, targetQuery: 'cart' },
    ]);

    const initial = engine.findLearnedExemplar(phrase);
    expect(initial?.confidence).toBeGreaterThan(0.7);
    const initialConfidence = initial!.confidence;

    await engine.recordUndo(phrase);
    const afterUndo = engine.findLearnedExemplar(phrase);
    expect(afterUndo?.timesUndone).toBe(1);
    expect(afterUndo?.confidence).toBeLessThan(initialConfidence);
  });

  it('formats few-shot prompt exemplars for Qwen local model', async () => {
    await engine.recordSuccess('go to checkout now', [
      { type: 'CLICK_TARGET', rawText: 'go to checkout now', targetQuery: 'checkout' },
    ]);

    const promptFewShot = engine.getFewShotPromptExemplars(2);
    expect(promptFewShot).toContain('go to checkout now');
    expect(promptFewShot).toContain('CLICK_TARGET');
  });
});
