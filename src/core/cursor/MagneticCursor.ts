/**
 * Handsfree Magnetic Cursor
 * Provides gentle, optional magnetic attraction toward nearby visible, actionable DOM elements.
 *
 * Rules:
 * 1. Attracts gently without locking or snapping.
 * 2. Does not jump between competing adjacent targets if ambiguous.
 * 3. Free smooth movement in empty areas.
 * 4. Easily toggleable by the user.
 */

import { ActionableElement } from '../../types/intent';

export interface MagneticConfig {
  enabled: boolean;
  attractionRadiusPx: number; // Max distance to begin attracting (default: 38px)
  attractionStrength: number; // Pull factor 0.0 to 1.0 (default: 0.32)
}

export class MagneticCursor {
  private config: MagneticConfig;

  constructor(config: Partial<MagneticConfig> = {}) {
    this.config = {
      enabled: config.enabled ?? true,
      attractionRadiusPx: config.attractionRadiusPx ?? 38,
      attractionStrength: config.attractionStrength ?? 0.32,
    };
  }

  public setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }

  public setConfig(config: Partial<MagneticConfig>): void {
    this.config = { ...this.config, ...config };
  }

  public getConfig(): MagneticConfig {
    return { ...this.config };
  }

  /**
   * Applies magnetic pull towards the closest candidate within attractionRadiusPx
   */
  public applyMagneticPull(
    rawX: number,
    rawY: number,
    candidates: ActionableElement[]
  ): { x: number; y: number; nearestElement: ActionableElement | null } {
    if (!this.config.enabled || candidates.length === 0) {
      return { x: rawX, y: rawY, nearestElement: null };
    }

    let minDistance = Infinity;
    let nearest: ActionableElement | null = null;
    let secondDistance = Infinity;

    for (const el of candidates) {
      const dist = Math.hypot(el.centerX - rawX, el.centerY - rawY);
      if (dist < minDistance) {
        secondDistance = minDistance;
        minDistance = dist;
        nearest = el;
      } else if (dist < secondDistance) {
        secondDistance = dist;
      }
    }

    // Must be within attraction radius
    if (!nearest || minDistance > this.config.attractionRadiusPx) {
      return { x: rawX, y: rawY, nearestElement: null };
    }

    // Ambiguity guard: If two competing targets are nearly equidistant (< 10px difference), do not pull
    if (Math.abs(secondDistance - minDistance) < 10 && secondDistance <= this.config.attractionRadiusPx) {
      return { x: rawX, y: rawY, nearestElement: null };
    }

    // Calculate interpolated pull
    // Closer distance gets slightly stronger pull, smooth falloff
    const factor = (1 - minDistance / this.config.attractionRadiusPx) * this.config.attractionStrength;
    const pulledX = rawX + (nearest.centerX - rawX) * factor;
    const pulledY = rawY + (nearest.centerY - rawY) * factor;

    return {
      x: pulledX,
      y: pulledY,
      nearestElement: nearest,
    };
  }
}
