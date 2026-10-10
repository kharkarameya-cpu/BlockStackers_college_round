import { describe, it, expect, beforeAll } from 'vitest';
import { SemanticResolver } from '../core/semantic/SemanticResolver';
import { ActionableElement } from '../types/intent';

class MockElement {
  getBoundingClientRect() {
    return { width: 100, height: 40, left: 0, top: 0, right: 100, bottom: 40 };
  }
}

describe('SemanticResolver', () => {
  beforeAll(() => {
    (globalThis as any).document = {
      contains: () => true,
    };
  });

  const createElement = (
    id: string,
    accessibleName: string,
    visibleText: string,
    x: number = 200,
    y: number = 200,
    price?: number
  ): ActionableElement => ({
    id,
    element: new MockElement() as any,
    tagName: 'button',
    role: 'button',
    accessibleName,
    ariaLabel: accessibleName,
    visibleText,
    rect: { width: 100, height: 40, left: x - 50, top: y - 20, right: x + 50, bottom: y + 20 } as any,
    centerX: x,
    centerY: y,
    price,
    isConsequential: false,
    isDisabled: false,
  });

  it('ranks exact matches higher than fuzzy matches', () => {
    const el1 = createElement('1', 'Submit Application', 'Submit Application');
    const el2 = createElement('2', 'Application Guide', 'Application Guide');
    const elements = [el2, el1];

    const matches = SemanticResolver.resolve('Submit Application', elements);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches[0].candidate.id).toBe('1');
    expect(matches[0].matchType).toBe('EXACT');
    expect(matches[0].score).toBeGreaterThan(0.95);
  });

  it('correctly sorts and selects the cheapest option based on parsed prices', () => {
    const flightA = createElement('a', 'Flight A - $299', '$299', 100, 100, 299);
    const flightB = createElement('b', 'Flight B - $149', '$149', 100, 200, 149);
    const flightC = createElement('c', 'Flight C - $499', '$499', 100, 300, 499);

    const matches = SemanticResolver.resolve('cheapest', [flightA, flightB, flightC], {
      superlative: 'CHEAPEST',
    });

    expect(matches.length).toBe(3);
    // Flight B ($149) should be first!
    expect(matches[0].candidate.id).toBe('b');
    expect(matches[0].candidate.price).toBe(149);
    expect(matches[0].matchType).toBe('SUPERLATIVE');
  });

  it('selects ordinal candidates accurately', () => {
    const item1 = createElement('1', 'Alpha', 'Alpha');
    const item2 = createElement('2', 'Beta', 'Beta');
    const item3 = createElement('3', 'Gamma', 'Gamma');

    const matches = SemanticResolver.resolve('', [item1, item2, item3], {
      ordinalIndex: 1, // 0-based for second
    });

    expect(matches.length).toBe(1);
    expect(matches[0].candidate.id).toBe('2');
    expect(matches[0].matchType).toBe('ORDINAL');
  });

  it('detects ambiguity when multiple candidates closely match', () => {
    const btn1 = createElement('1', 'Log In to Personal Account', 'Log In to Personal');
    const btn2 = createElement('2', 'Log In to Business Account', 'Log In to Business');

    const matches = SemanticResolver.resolve('Log In', [btn1, btn2]);
    expect(matches.length).toBe(2);
    expect(SemanticResolver.isAmbiguous(matches)).toBe(true);
  });

  it('boosts candidate score when pointer is nearby (multimodal fusion)', () => {
    const distantBtn = createElement('1', 'Settings', 'Settings', 1000, 1000);
    const nearbyBtn = createElement('2', 'Settings', 'Settings', 110, 110);

    const matches = SemanticResolver.resolve('Settings', [distantBtn, nearbyBtn], {
      cursorX: 100,
      cursorY: 100,
    });

    // Nearby button gets proximity boost and ranks first
    expect(matches[0].candidate.id).toBe('2');
    expect(matches[0].score).toBeGreaterThan(matches[1].score);
  });
});
