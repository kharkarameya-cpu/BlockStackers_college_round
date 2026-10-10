import { describe, it, expect } from 'vitest';
import { MagneticCursor } from '../core/cursor/MagneticCursor';
import { ActionableElement } from '../types/intent';

describe('MagneticCursor', () => {
  const createCandidate = (id: string, x: number, y: number): ActionableElement => ({
    id,
    element: {} as any,
    tagName: 'button',
    role: 'button',
    accessibleName: `Btn ${id}`,
    ariaLabel: `Btn ${id}`,
    visibleText: `Btn ${id}`,
    rect: { width: 50, height: 30, left: x - 25, top: y - 15, right: x + 25, bottom: y + 15 } as any,
    centerX: x,
    centerY: y,
    isConsequential: false,
    isDisabled: false,
  });

  it('gently pulls cursor towards nearby candidate within attraction radius', () => {
    const magnetic = new MagneticCursor({ attractionRadiusPx: 40, attractionStrength: 0.5 });
    const target = createCandidate('1', 100, 100);

    // Cursor is 20px away from candidate
    const result = magnetic.applyMagneticPull(80, 100, [target]);

    expect(result.nearestElement?.id).toBe('1');
    // Pulled closer to 100
    expect(result.x).toBeGreaterThan(80);
    expect(result.x).toBeLessThan(100);
    expect(result.y).toBe(100);
  });

  it('leaves cursor untouched when candidate is outside attraction radius', () => {
    const magnetic = new MagneticCursor({ attractionRadiusPx: 30 });
    const distantTarget = createCandidate('1', 200, 200);

    const result = magnetic.applyMagneticPull(50, 50, [distantTarget]);

    expect(result.x).toBe(50);
    expect(result.y).toBe(50);
    expect(result.nearestElement).toBeNull();
  });

  it('suppresses pull when two competing targets are nearly equidistant', () => {
    const magnetic = new MagneticCursor({ attractionRadiusPx: 40 });
    // Candidate A is at (80, 100) -> 20px from cursor (100, 100)
    // Candidate B is at (120, 100) -> 20px from cursor (100, 100)
    const candA = createCandidate('a', 80, 100);
    const candB = createCandidate('b', 120, 100);

    const result = magnetic.applyMagneticPull(100, 100, [candA, candB]);

    // Should not snap to either
    expect(result.x).toBe(100);
    expect(result.y).toBe(100);
  });

  it('does nothing when disabled', () => {
    const magnetic = new MagneticCursor({ enabled: false });
    const target = createCandidate('1', 100, 100);

    const result = magnetic.applyMagneticPull(90, 100, [target]);
    expect(result.x).toBe(90);
    expect(result.nearestElement).toBeNull();
  });
});
