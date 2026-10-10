import { describe, it, expect, beforeEach } from 'vitest';
import { OneEuroFilter, OneEuroFilter2D } from '../core/filters/OneEuroFilter';

describe('OneEuroFilter', () => {
  let filter: OneEuroFilter;

  beforeEach(() => {
    filter = new OneEuroFilter(1.0, 0.007, 1.0);
  });

  it('should initialize and return the first sample directly', () => {
    const val = filter.filter(100, 0);
    expect(val).toBe(100);
  });

  it('should significantly reduce jitter on noisy stationary signal', () => {
    // Generate stationary signal with high-frequency noise: true value = 50, noise = +/- 2
    let t = 0;
    const dt = 33; // ~30 fps
    const rawValues: number[] = [];
    const filteredValues: number[] = [];

    for (let i = 0; i < 50; i++) {
      const noise = (i % 2 === 0 ? 1 : -1) * 2.0;
      const raw = 50 + noise;
      rawValues.push(raw);
      filteredValues.push(filter.filter(raw, t));
      t += dt;
    }

    // Calculate variance of raw vs filtered in the second half
    const halfRaw = rawValues.slice(25);
    const halfFilt = filteredValues.slice(25);

    const varianceRaw = halfRaw.reduce((acc, v) => acc + Math.pow(v - 50, 2), 0) / halfRaw.length;
    const varianceFilt = halfFilt.reduce((acc, v) => acc + Math.pow(v - 50, 2), 0) / halfFilt.length;

    // Filtered variance should be significantly smaller than raw variance
    expect(varianceFilt).toBeLessThan(varianceRaw * 0.3);
  });

  it('should adaptively respond to fast velocity transitions without excessive lag', () => {
    let t = 0;
    const dt = 33;

    // Settle at 0
    for (let i = 0; i < 20; i++) {
      filter.filter(0, t);
      t += dt;
    }

    // Rapid step jump to 500
    let stepOutput = 0;
    for (let i = 0; i < 15; i++) {
      stepOutput = filter.filter(500, t);
      t += dt;
    }

    // After 15 frames (~500ms), adaptive beta should bring the signal very close to the target
    expect(stepOutput).toBeGreaterThan(450);
  });

  it('should correctly reset state', () => {
    filter.filter(100, 0);
    filter.filter(110, 33);
    filter.reset();

    // After reset, the next sample should be treated as the first
    const val = filter.filter(500, 100);
    expect(val).toBe(500);
  });
});

describe('OneEuroFilter2D', () => {
  it('should filter both X and Y dimensions independently', () => {
    const filter2D = new OneEuroFilter2D(1.0, 0.007, 1.0);
    const res1 = filter2D.filter(100, 200, 0);
    expect(res1.x).toBe(100);
    expect(res1.y).toBe(200);

    const res2 = filter2D.filter(105, 205, 33);
    expect(res2.x).toBeGreaterThan(100);
    expect(res2.x).toBeLessThan(105);
    expect(res2.y).toBeGreaterThan(200);
    expect(res2.y).toBeLessThan(205);
  });
});
