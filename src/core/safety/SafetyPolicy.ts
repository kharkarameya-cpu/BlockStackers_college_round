/**
 * Handsfree Safety Policy
 * Independently enforces action permissions, risk classification, and confirmation gates.
 */

import { ActionableElement, ActionRiskLevel } from '../../types/intent';

export class SafetyPolicy {
  /**
   * Evaluates the risk level of activating a target element
   */
  public static classifyRisk(element: ActionableElement | null): ActionRiskLevel {
    if (!element) return 'LOW';

    // Direct check for consequential patterns
    if (element.isConsequential) {
      return 'HIGH';
    }

    // Inspect tag & attributes
    if (element.tagName === 'input' && (element.element as HTMLInputElement).type === 'submit') {
      return 'HIGH';
    }

    // Navigational links and buttons with external or form targets
    const href =
      element.element && typeof element.element.getAttribute === 'function'
        ? element.element.getAttribute('href') || ''
        : '';
    if (href.startsWith('mailto:') || href.startsWith('tel:')) {
      return 'MEDIUM';
    }

    return 'LOW';
  }

  /**
   * Evaluates whether an action requires explicit user confirmation
   */
  public static requiresConfirmation(element: ActionableElement): boolean {
    const risk = SafetyPolicy.classifyRisk(element);
    return risk === 'HIGH';
  }

  /**
   * Validates if dwell activation is permitted for a target element
   * Rule: Dwell alone MUST NEVER activate high-impact / consequential actions
   */
  public static isDwellActivationPermitted(element: ActionableElement | null): boolean {
    if (!element) return false;
    const risk = SafetyPolicy.classifyRisk(element);
    return risk === 'LOW';
  }

  /**
   * Final safety gate immediately before action execution
   */
  public static validateExecutionSafety(
    element: ActionableElement | null,
    origin: 'DWELL' | 'VOICE_CONFIRMED' | 'VOICE_DIRECT'
  ): { permitted: boolean; reason?: string } {
    if (!element || !element.element) {
      return { permitted: false, reason: 'Null or missing target element' };
    }

    // Verify element is still in active DOM
    if (typeof document !== 'undefined' && !document.contains(element.element)) {
      return { permitted: false, reason: 'Target element was detached from the DOM' };
    }

    const risk = SafetyPolicy.classifyRisk(element);

    // Rule: Dwell cannot trigger HIGH risk actions
    if (origin === 'DWELL' && risk === 'HIGH') {
      return {
        permitted: false,
        reason: 'Consequential action blocked: High-risk targets cannot be activated by dwell alone',
      };
    }

    // Rule: Unconfirmed voice activation cannot trigger HIGH risk actions
    if (origin === 'VOICE_DIRECT' && risk === 'HIGH') {
      return {
        permitted: false,
        reason: 'Confirmation required: Consequential action needs explicit voice confirmation',
      };
    }

    return { permitted: true };
  }
}
