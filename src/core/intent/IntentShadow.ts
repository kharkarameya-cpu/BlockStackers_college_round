/**
 * Handsfree Intent Shadow
 * Maintains short-lived, non-executing hypotheses of the user's likely next interaction.
 *
 * Rules:
 * 1. Predictions must NEVER execute actions on their own.
 * 2. Hypotheses automatically expire after a configurable duration.
 * 3. Invalidated when page URL changes or DOM clears.
 * 4. Resolves natural-language references like "that one" or "the second choice".
 */

import { ActionableElement, ShadowHypothesis } from '../../types/intent';
import { SemanticResolver } from '../semantic/SemanticResolver';

export class IntentShadow {
  private hypotheses: ShadowHypothesis[] = [];
  private currentUrl: string = '';
  private readonly ttlMs: number;

  constructor(ttlMs: number = 8000) {
    this.ttlMs = ttlMs;
    if (typeof window !== 'undefined') {
      this.currentUrl = window.location.href;
    }
  }

  /**
   * Register a new hypothesis (e.g. user cursor lingered over an element or candidate was shown)
   */
  public registerHypothesis(
    target: ActionableElement,
    source: ShadowHypothesis['source']
  ): void {
    this.cleanExpired();

    const now = Date.now();
    // Avoid duplicates
    this.hypotheses = this.hypotheses.filter((h) => h.target.id !== target.id);

    this.hypotheses.unshift({
      target,
      createdTimestamp: now,
      expiryTimestamp: now + this.ttlMs,
      source,
    });

    // Cap at most 5 recent hypotheses
    if (this.hypotheses.length > 5) {
      this.hypotheses = this.hypotheses.slice(0, 5);
    }
  }

  /**
   * Resolves contextual queries like "that one", "click that", "the first one"
   */
  public resolveContextualTarget(query: string): ActionableElement | null {
    this.cleanExpired();
    if (this.hypotheses.length === 0) return null;

    const lower = query.toLowerCase().trim();

    // "that one" / "click that" / "select it" -> latest active hypothesis
    if (
      lower === 'that one' ||
      lower === 'that' ||
      lower === 'click that' ||
      lower === 'it' ||
      lower === 'select it' ||
      lower === 'open that'
    ) {
      const candidate = this.hypotheses[0]?.target;
      if (candidate && SemanticResolver.isElementValid(candidate)) {
        return candidate;
      }
    }

    // Ordinals against shadow list
    if (lower.includes('first') && this.hypotheses[0]) {
      return SemanticResolver.isElementValid(this.hypotheses[0].target)
        ? this.hypotheses[0].target
        : null;
    }
    if (lower.includes('second') && this.hypotheses[1]) {
      return SemanticResolver.isElementValid(this.hypotheses[1].target)
        ? this.hypotheses[1].target
        : null;
    }
    if (lower.includes('third') && this.hypotheses[2]) {
      return SemanticResolver.isElementValid(this.hypotheses[2].target)
        ? this.hypotheses[2].target
        : null;
    }

    return null;
  }

  /**
   * Returns current active, unexpired hypotheses
   */
  public getActiveHypotheses(): ActionableElement[] {
    this.cleanExpired();
    return this.hypotheses
      .map((h) => h.target)
      .filter((t) => SemanticResolver.isElementValid(t));
  }

  public clear(): void {
    this.hypotheses = [];
  }

  /**
   * Checks if page changed URL and resets if necessary
   */
  public checkPageIntegrity(): void {
    if (typeof window !== 'undefined' && window.location.href !== this.currentUrl) {
      this.currentUrl = window.location.href;
      this.clear();
    }
  }

  private cleanExpired(): void {
    this.checkPageIntegrity();
    const now = Date.now();
    this.hypotheses = this.hypotheses.filter((h) => h.expiryTimestamp > now);
  }
}
