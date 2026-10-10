/**
 * 1€ Filter (One Euro Filter)
 * An adaptive first-order low-pass filter for noisy human input signals.
 * Casiez, Roussel, Vogel (CHI 2012)
 *
 * Characteristics:
 * - High jitter attenuation at low velocities (steady pointing / dwell)
 * - Minimal lag at high velocities (quick navigation across the screen)
 */

export class LowPassFilter {
  private y: number | null = null;
  private s: number | null = null;

  constructor(private alpha: number = 0) {
    this.setAlpha(alpha);
  }

  public setAlpha(alpha: number): void {
    if (alpha <= 0 || alpha > 1.0) {
      this.alpha = Math.max(0.0001, Math.min(1.0, alpha));
    } else {
      this.alpha = alpha;
    }
  }

  public filter(value: number): number {
    if (!Number.isFinite(value)) {
      return this.s ?? 0;
    }
    if (this.y === null || this.s === null || !Number.isFinite(this.s)) {
      this.s = value;
    } else {
      this.s = this.alpha * value + (1.0 - this.alpha) * this.s;
    }
    this.y = value;
    return this.s;
  }

  public filterWithAlpha(value: number, alpha: number): number {
    this.setAlpha(alpha);
    return this.filter(value);
  }

  public hasLastValue(): boolean {
    return this.y !== null && Number.isFinite(this.s ?? NaN);
  }

  public lastValue(): number {
    return Number.isFinite(this.s ?? NaN) ? this.s! : 0;
  }

  public reset(): void {
    this.y = null;
    this.s = null;
  }
}

export class OneEuroFilter {
  private xFilt: LowPassFilter;
  private dxFilt: LowPassFilter;
  private lastTime: number | null = null;

  /**
   * @param minCutoff Minimum cutoff frequency in Hz (> 0). Lower = less jitter at rest. Default 1.0.
   * @param beta Speed coefficient (> 0). Higher = less lag during rapid movement. Default 0.007.
   * @param dCutoff Cutoff frequency for derivative in Hz (> 0). Default 1.0.
   */
  constructor(
    private minCutoff: number = 1.0,
    private beta: number = 0.007,
    private dCutoff: number = 1.0
  ) {
    this.xFilt = new LowPassFilter();
    this.dxFilt = new LowPassFilter();
  }

  private alpha(rate: number, cutoff: number): number {
    const tau = 1.0 / (2 * Math.PI * cutoff);
    const te = 1.0 / rate;
    return 1.0 / (1.0 + tau / te);
  }

  /**
   * Filter an incoming scalar value at the given timestamp (in milliseconds or seconds).
   * @param value The raw input value
   * @param timestamp Timestamp in milliseconds
   */
  public filter(value: number, timestamp: number): number {
    if (!Number.isFinite(value)) {
      return this.xFilt.lastValue();
    }

    if (this.lastTime === null || !Number.isFinite(this.lastTime)) {
      this.lastTime = Number.isFinite(timestamp) ? timestamp : performance.now();
      return this.xFilt.filter(value);
    }

    // Compute sampling rate dt in seconds
    const curTime = Number.isFinite(timestamp) && timestamp >= this.lastTime ? timestamp : performance.now();
    const dt = Math.max(0.0001, (curTime - this.lastTime) / 1000.0);
    this.lastTime = curTime;
    const rate = 1.0 / dt;

    // Estimate derivative (velocity) of input signal
    const prevX = this.xFilt.lastValue();
    const dx = (value - prevX) * rate;

    const edx = this.dxFilt.filterWithAlpha(dx, this.alpha(rate, this.dCutoff));

    // Adaptive cutoff frequency: increases as velocity increases
    const cutoff = this.minCutoff + this.beta * Math.abs(edx);

    // Filter position with adaptive alpha
    const filtered = this.xFilt.filterWithAlpha(value, this.alpha(rate, cutoff));
    return Number.isFinite(filtered) ? filtered : value;
  }

  public setParams(minCutoff: number, beta: number, dCutoff: number): void {
    this.minCutoff = Math.max(0.01, minCutoff);
    this.beta = Math.max(0.0, beta);
    this.dCutoff = Math.max(0.01, dCutoff);
  }

  public reset(): void {
    this.xFilt.reset();
    this.dxFilt.reset();
    this.lastTime = null;
  }
}

/**
 * 2D One Euro Filter for screen coordinates (x, y).
 */
export class OneEuroFilter2D {
  private xFilter: OneEuroFilter;
  private yFilter: OneEuroFilter;

  constructor(minCutoff: number = 1.0, beta: number = 0.007, dCutoff: number = 1.0) {
    this.xFilter = new OneEuroFilter(minCutoff, beta, dCutoff);
    this.yFilter = new OneEuroFilter(minCutoff, beta, dCutoff);
  }

  public filter(x: number, y: number, timestamp: number): { x: number; y: number } {
    return {
      x: this.xFilter.filter(x, timestamp),
      y: this.yFilter.filter(y, timestamp),
    };
  }

  public setParams(minCutoff: number, beta: number, dCutoff: number): void {
    this.xFilter.setParams(minCutoff, beta, dCutoff);
    this.yFilter.setParams(minCutoff, beta, dCutoff);
  }

  public reset(): void {
    this.xFilter.reset();
    this.yFilter.reset();
  }
}
