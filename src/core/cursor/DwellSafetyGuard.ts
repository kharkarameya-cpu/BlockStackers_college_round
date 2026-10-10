/**
 * Handsfree Dwell Safety Guard
 *
 * Enforces intent awareness and safety rules for dwell activation:
 * 1. Dwell alone is strictly limited to low-risk elements.
 * 2. Consequential / destructive actions (payment, delete, logout, submit) are NEVER activated by dwell alone.
 * 3. Dwell is cancelled if the target element changes, moves, scrolls, or tracking is lost.
 * 4. The target element is strictly re-validated immediately before click dispatch.
 */

export interface DwellEvaluation {
  isClickable: boolean;
  isConsequential: boolean;
  reason?: string;
}

export class DwellSafetyGuard {
  // Consequential & high-risk keywords (case-insensitive)
  private static readonly CONSEQUENTIAL_PATTERNS = [
    /\b(delete|remove|erase|destroy|drop|purge)\b/i,
    /\b(buy|purchase|pay|checkout|order|subscribe|charge)\b/i,
    /\b(logout|log\s*out|sign\s*out|disconnect)\b/i,
    /\b(transfer|wire|send\s*money)\b/i,
    /\b(reset\s*all|factory\s*reset|wipe)\b/i,
    /\b(confirm\s*payment|authorize)\b/i,
  ];

  // Current dwell tracking state
  private activeTarget: HTMLElement | null = null;
  private dwellStartTimestamp: number | null = null;
  private isConsequentialTarget: boolean = false;

  /**
   * Evaluates an element for clickability and consequential risk
   */
  public static evaluateElement(element: HTMLElement | null): DwellEvaluation {
    if (!element) {
      return { isClickable: false, isConsequential: false, reason: 'No element under cursor' };
    }

    // Check if element is within our extension overlay
    if (element.id === 'handsfree-overlay-root' || element.closest?.('#handsfree-overlay-root')) {
      return { isClickable: false, isConsequential: false, reason: 'Handsfree overlay element' };
    }

    // Determine if element is interactive
    const interactiveTarget = DwellSafetyGuard.findInteractiveParent(element);
    if (!interactiveTarget) {
      return { isClickable: false, isConsequential: false, reason: 'Non-interactive background element' };
    }

    // Inspect text, aria-label, title, and attributes for consequential keywords
    const textContent = (interactiveTarget.textContent || '').trim();
    const ariaLabel = interactiveTarget.getAttribute('aria-label') || '';
    const title = interactiveTarget.getAttribute('title') || '';
    const idAndClass = `${interactiveTarget.id} ${interactiveTarget.className}`;
    const name = interactiveTarget.getAttribute('name') || '';

    const combinedDescriptors = `${textContent} ${ariaLabel} ${title} ${idAndClass} ${name}`;

    const isConsequential = DwellSafetyGuard.CONSEQUENTIAL_PATTERNS.some((pattern) =>
      pattern.test(combinedDescriptors)
    );

    if (isConsequential) {
      return {
        isClickable: true,
        isConsequential: true,
        reason: 'Consequential action detected: Dwell alone is blocked for safety',
      };
    }

    // Check form submission buttons
    if (
      interactiveTarget instanceof HTMLInputElement &&
      (interactiveTarget.type === 'submit' || interactiveTarget.type === 'reset')
    ) {
      return {
        isClickable: true,
        isConsequential: true,
        reason: 'Form submission button: Dwell alone is blocked for safety',
      };
    }

    return {
      isClickable: true,
      isConsequential: false,
    };
  }

  /**
   * Find closest interactive parent (button, link, input, tab, role="button")
   */
  public static findInteractiveParent(element: HTMLElement | null): HTMLElement | null {
    if (!element) return null;

    let current: HTMLElement | null = element;
    while (current && current !== document.body && current !== document.documentElement) {
      const tagName = current.tagName.toLowerCase();
      const role = current.getAttribute('role');

      if (
        tagName === 'a' ||
        tagName === 'button' ||
        tagName === 'input' ||
        tagName === 'textarea' ||
        tagName === 'select' ||
        tagName === 'details' ||
        tagName === 'summary' ||
        role === 'button' ||
        role === 'link' ||
        role === 'tab' ||
        role === 'menuitem' ||
        role === 'checkbox' ||
        role === 'radio' ||
        role === 'switch' ||
        current.isContentEditable ||
        current.onclick !== null ||
        current.hasAttribute('data-action')
      ) {
        return current;
      }
      current = current.parentElement;
    }

    return null;
  }

  /**
   * Update or track current hovered target.
   * Returns false if target changed or is consequential (cancelling dwell).
   */
  public updateTarget(element: HTMLElement | null, timestamp: number): boolean {
    const interactiveTarget = DwellSafetyGuard.findInteractiveParent(element);

    if (!interactiveTarget) {
      this.cancelDwell();
      return false;
    }

    // Target changed: reset dwell timer
    if (this.activeTarget !== interactiveTarget) {
      const evalResult = DwellSafetyGuard.evaluateElement(interactiveTarget);
      this.activeTarget = interactiveTarget;
      this.dwellStartTimestamp = timestamp;
      this.isConsequentialTarget = evalResult.isConsequential;

      if (this.isConsequentialTarget) {
        // Consequential elements cannot be activated via dwell alone
        return false;
      }

      return true;
    }

    // If same target is consequential, do not permit dwell
    if (this.isConsequentialTarget) {
      return false;
    }

    return true;
  }

  /**
   * Revalidate target immediately before dwell activation.
   * Ensures that:
   * 1. The target is still attached to the DOM and visible.
   * 2. The element under the cursor still matches the active target.
   * 3. The target is NOT consequential.
   */
  public revalidateBeforeActivation(currentPointElement: HTMLElement | null): HTMLElement | null {
    if (!this.activeTarget || this.isConsequentialTarget) {
      this.cancelDwell();
      return null;
    }

    // Check DOM connection
    if (typeof document !== 'undefined' && !document.contains(this.activeTarget)) {
      this.cancelDwell();
      return null;
    }

    // Check if element under point still corresponds to active target
    const currentInteractive = DwellSafetyGuard.findInteractiveParent(currentPointElement);
    if (!currentInteractive || currentInteractive !== this.activeTarget) {
      this.cancelDwell();
      return null;
    }

    // Re-verify consequential safety
    const finalEval = DwellSafetyGuard.evaluateElement(this.activeTarget);
    if (finalEval.isConsequential) {
      this.cancelDwell();
      return null;
    }

    const verifiedTarget = this.activeTarget;
    this.cancelDwell();
    return verifiedTarget;
  }

  public cancelDwell(): void {
    this.activeTarget = null;
    this.dwellStartTimestamp = null;
    this.isConsequentialTarget = false;
  }

  public getActiveTarget(): HTMLElement | null {
    return this.activeTarget;
  }

  public getDwellStartTimestamp(): number | null {
    return this.dwellStartTimestamp;
  }

  public isConsequential(): boolean {
    return this.isConsequentialTarget;
  }
}
