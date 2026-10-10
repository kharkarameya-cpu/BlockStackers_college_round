import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { IntentShadow } from '../core/intent/IntentShadow';
import { ActionableElement } from '../types/intent';

class MockElement {
  getBoundingClientRect() {
    return { width: 100, height: 40, left: 0, top: 0, right: 100, bottom: 40 };
  }
}

describe('IntentShadow', () => {
  let shadow: IntentShadow;

  beforeAll(() => {
    (globalThis as any).document = {
      contains: () => true,
    };
  });

  beforeEach(() => {
    shadow = new IntentShadow(500); // 500ms TTL for testing
  });

  const createElement = (id: string, name: string): ActionableElement => ({
    id,
    element: new MockElement() as any,
    tagName: 'button',
    role: 'button',
    accessibleName: name,
    ariaLabel: name,
    visibleText: name,
    rect: { width: 100, height: 40, left: 0, top: 0, right: 100, bottom: 40 } as any,
    centerX: 50,
    centerY: 20,
    isConsequential: false,
    isDisabled: false,
  });

  it('resolves "that one" against recently registered hypothesis', () => {
    const target = createElement('1', 'Download Brochure');
    shadow.registerHypothesis(target, 'CURSOR_HOVER');

    const resolved = shadow.resolveContextualTarget('that one');
    expect(resolved).not.toBeNull();
    expect(resolved?.id).toBe('1');
  });

  it('expires hypotheses after TTL duration', async () => {
    const target = createElement('1', 'Special Offer');
    shadow.registerHypothesis(target, 'VOICE_CANDIDATE');

    expect(shadow.getActiveHypotheses().length).toBe(1);

    // Wait past 500ms TTL
    await new Promise((r) => setTimeout(r, 550));

    expect(shadow.getActiveHypotheses().length).toBe(0);
    expect(shadow.resolveContextualTarget('that one')).toBeNull();
  });

  it('supports ordinal resolution against active hypothesis stack', () => {
    const first = createElement('1', 'First Choice');
    const second = createElement('2', 'Second Choice');

    shadow.registerHypothesis(second, 'VOICE_CANDIDATE');
    shadow.registerHypothesis(first, 'VOICE_CANDIDATE');

    const resolved = shadow.resolveContextualTarget('the second one');
    expect(resolved?.id).toBe('2');
  });

  it('clears hypotheses when manually reset', () => {
    const target = createElement('1', 'Cart');
    shadow.registerHypothesis(target, 'CURSOR_HOVER');
    shadow.clear();

    expect(shadow.getActiveHypotheses().length).toBe(0);
  });
});
