import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LocalAIEngine } from '../core/ai/LocalAIEngine';
import { IntentLearningEngine } from '../core/ai/IntentLearningEngine';

describe('LocalAIEngine - Complex Sentences & Decomposition', () => {
  let aiEngine: LocalAIEngine;
  let learningEngine: IntentLearningEngine;

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('Fetch network offline'));
    aiEngine = LocalAIEngine.getInstance();
    learningEngine = IntentLearningEngine.getInstance();
    learningEngine.getExemplars().length = 0;
    learningEngine.getAliases().length = 0;
  });

  it('decomposes sequential compound sentence: "scroll down and click on pricing"', async () => {
    const result = await aiEngine.parseComplexSentence('scroll down and click on pricing');

    expect(result.actions).toHaveLength(2);
    expect(result.actions[0].type).toBe('SCROLL_DOWN');
    expect(result.actions[1].type).toBe('CLICK_TARGET');
    expect(result.actions[1].targetQuery).toBe('pricing');
  });

  it('decomposes search and enter sentence: "search for laptops and press enter"', async () => {
    const result = await aiEngine.parseComplexSentence('search for laptops and press enter');

    expect(result.actions.length).toBeGreaterThanOrEqual(2);
    expect(result.actions[0].type).toBe('FOCUS_INPUT');
    expect(result.actions[1].type).toBe('TYPE_TEXT');
    expect(result.actions[1].text).toBe('laptops');
    expect(result.actions[2].type).toBe('PRESS_ENTER');
  });

  it('resolves tab and browser navigation commands: "open settings and next tab"', async () => {
    const result = await aiEngine.parseComplexSentence('open settings and next tab');

    expect(result.actions).toHaveLength(2);
    expect(result.actions[0].type).toBe('OPEN_SETTINGS');
    expect(result.actions[1].type).toBe('NEXT_TAB');
  });

  it('resolves exact personal alias before attempting LLM or rule decomposition', async () => {
    await learningEngine.teachAlias('my custom shortcut', 'REFRESH_PAGE');

    const result = await aiEngine.parseComplexSentence('my custom shortcut');
    expect(result.source).toBe('EXACT_ALIAS');
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0].type).toBe('REFRESH_PAGE');
  });

  it('recalls learned exemplar from memory cache on repeated complex queries', async () => {
    const complex = 'scroll up a little and click sign in';
    // First run creates decomposition
    const firstResult = await aiEngine.parseComplexSentence(complex);
    await learningEngine.recordSuccess(complex, firstResult.actions);

    // Second run hits learned exemplar bank directly (<2ms)
    const secondResult = await aiEngine.parseComplexSentence(complex);
    expect(secondResult.source).toBe('LEARNED_EXEMPLAR');
    expect(secondResult.actions).toHaveLength(2);
    expect(secondResult.actions[0].type).toBe('SCROLL_UP');
  });

  it('gracefully handles connection test failure with helpful diagnostic message', async () => {
    const status = await aiEngine.testConnection({
      enabled: true,
      provider: 'OLLAMA',
      endpoint: 'http://localhost:99999',
      model: 'qwen2.5:0.5b',
      temperature: 0.1,
      maxTokens: 100,
    });

    expect(status.connected).toBe(false);
    expect(status.message).toContain('Hybrid neural rules will serve as fallback');
  });
});
