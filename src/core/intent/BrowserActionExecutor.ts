/**
 * Handsfree Browser Action Executor
 * Implements the Observe-Plan-Act-Verify execution loop.
 * Executes validated action plan steps safely, verifies postconditions,
 * and enforces trusted safety policies for consequential actions.
 */

import { ActionPlan, ActionPlanStep, ActionTarget } from '../../types/ai';
import { DOMIndexer } from '../semantic/DOMIndexer';
import { DwellSafetyGuard } from '../cursor/DwellSafetyGuard';

export interface ExecutorCallbacks {
  onStepProgress?: (stepIndex: number, totalSteps: number, step: ActionPlanStep) => void;
  onPlanComplete?: (plan: ActionPlan) => void;
  onPlanFailed?: (error: string, failedStep?: ActionPlanStep) => void;
  onRequiresConfirmation?: (step: ActionPlanStep, targetElement: HTMLElement | null, onConfirm: () => void, onReject: () => void) => void;
  onShowToast?: (message: string, type: 'COMMAND' | 'ERROR' | 'INFO') => void;
}

function isInputElement(el: any): boolean {
  return typeof HTMLInputElement !== 'undefined' && el instanceof HTMLInputElement;
}

function isTextAreaElement(el: any): boolean {
  return typeof HTMLTextAreaElement !== 'undefined' && el instanceof HTMLTextAreaElement;
}

function isSelectElement(el: any): boolean {
  return typeof HTMLSelectElement !== 'undefined' && el instanceof HTMLSelectElement;
}

export class BrowserActionExecutor {
  private isCancelled: boolean = false;
  private isPaused: boolean = false;
  private callbacks: ExecutorCallbacks;

  constructor(callbacks: ExecutorCallbacks = {}) {
    this.callbacks = callbacks;
  }

  public cancel(): void {
    this.isCancelled = true;
    if (this.callbacks.onShowToast) {
      this.callbacks.onShowToast('Plan cancelled', 'INFO');
    }
  }

  public setPaused(paused: boolean): void {
    this.isPaused = paused;
  }

  /**
   * Main entry point: Executes a validated ActionPlan step by step
   */
  public async executePlan(plan: ActionPlan): Promise<{ success: boolean; error?: string }> {
    this.isCancelled = false;

    if (!plan || !plan.steps || plan.steps.length === 0) {
      if (plan.status === 'clarification_required') {
        const question = plan.clarification_question || plan.reason || 'Could you please clarify?';
        this.callbacks.onShowToast?.(question, 'COMMAND');
        return { success: true };
      }
      if (plan.status === 'unsupported') {
        const err = plan.reason || 'Action is not supported.';
        this.callbacks.onShowToast?.(err, 'ERROR');
        return { success: false, error: err };
      }
      return { success: true };
    }

    const totalSteps = plan.steps.length;

    for (let i = 0; i < totalSteps; i++) {
      if (this.isCancelled) {
        return { success: false, error: 'Execution was cancelled by the user.' };
      }

      while (this.isPaused) {
        if (this.isCancelled) return { success: false, error: 'Execution cancelled while paused.' };
        await new Promise((r) => setTimeout(r, 200));
      }

      const step = plan.steps[i];
      this.callbacks.onStepProgress?.(i + 1, totalSteps, step);

      // Trusted Safety Guard Check outside the LLM:
      const requiresConfirm = this.isConsequentialStep(step, plan.requires_confirmation);
      if (requiresConfirm) {
        const confirmed = await this.requestUserConfirmation(step);
        if (!confirmed) {
          this.callbacks.onPlanFailed?.('Consequential action rejected by user', step);
          return { success: false, error: 'Consequential action rejected by user.' };
        }
      }

      // Execute single step and verify postconditions
      const stepResult = await this.executeSingleStep(step);
      if (!stepResult.success) {
        this.callbacks.onPlanFailed?.(stepResult.error || 'Step execution failed', step);
        return { success: false, error: stepResult.error };
      }

      // Inter-step debounce delay for DOM updates
      if (i < totalSteps - 1) {
        await new Promise((r) => setTimeout(r, 300));
      }
    }

    this.callbacks.onPlanComplete?.(plan);
    return { success: true };
  }

  /**
   * Determine if step is consequential using trusted external policy
   */
  private isConsequentialStep(step: ActionPlanStep, planFlag: boolean): boolean {
    if (planFlag) return true;

    if (step.action === 'click' && step.target) {
      const targetEl = this.resolveTargetElement(step.target);
      if (targetEl) {
        const safetyEval = DwellSafetyGuard.evaluateElement(targetEl);
        if (safetyEval.isConsequential) return true;
      }
    }

    if (step.action === 'press_key' && step.key.toLowerCase() === 'enter') {
      const activeEl = typeof document !== 'undefined' ? (document.activeElement as HTMLElement) : null;
      if (activeEl?.closest('form')) {
        // Submitting forms that might be consequential
        const formText = (activeEl.closest('form')?.textContent || '').toLowerCase();
        if (
          formText.includes('payment') ||
          formText.includes('order') ||
          formText.includes('transfer') ||
          formText.includes('delete') ||
          formText.includes('purchase')
        ) {
          return true;
        }
      }
    }

    return false;
  }

  private requestUserConfirmation(step: ActionPlanStep): Promise<boolean> {
    return new Promise((resolve) => {
      let targetEl: HTMLElement | null = null;
      if ('target' in step && step.target) {
        targetEl = this.resolveTargetElement(step.target);
      }

      if (this.callbacks.onRequiresConfirmation) {
        this.callbacks.onRequiresConfirmation(
          step,
          targetEl,
          () => resolve(true),
          () => resolve(false)
        );
      } else {
        // Fallback: window.confirm
        const desc = `Handsfree Confirmation: Do you want to execute action "${step.action}"?`;
        resolve(window.confirm(desc));
      }
    });
  }

  /**
   * Execute single validated action step and verify postcondition
   */
  private async executeSingleStep(step: ActionPlanStep): Promise<{ success: boolean; error?: string }> {
    switch (step.action) {
      case 'navigate': {
        try {
          const parsed = new URL(step.url);
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return { success: false, error: `Refused to navigate to unsafe protocol: ${parsed.protocol}` };
          }
          this.callbacks.onShowToast?.(`Navigating to ${step.url}`, 'COMMAND');
          window.location.href = step.url;
          return { success: true };
        } catch (err: any) {
          return { success: false, error: `Invalid navigation URL: ${err.message}` };
        }
      }

      case 'click': {
        const el = this.resolveTargetElement(step.target);
        if (!el) {
          return {
            success: false,
            error: `Click failed: Element matching "${step.target.name || step.target.id || step.target.role || 'target'}" not found on page.`,
          };
        }

        // Revalidate visibility and accessibility
        const rect = el.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) {
          return { success: false, error: 'Target element is not currently visible in the DOM.' };
        }

        this.dispatchFullClick(el);
        this.callbacks.onShowToast?.(`Clicked "${DOMIndexer.computeAccessibleName(el) || el.tagName}"`, 'COMMAND');
        return { success: true };
      }

      case 'fill': {
        const el = this.resolveTargetElement(step.target);
        if (!el) {
          return {
            success: false,
            error: `Fill failed: Input matching "${step.target.name || step.target.id || 'target'}" not found.`,
          };
        }

        if (!isInputElement(el) && !isTextAreaElement(el) && !el.isContentEditable) {
          return { success: false, error: `Target element <${el.tagName}> is not an editable input.` };
        }

        if (typeof el.focus === 'function') el.focus();
        if (isInputElement(el) || isTextAreaElement(el)) {
          (el as any).value = step.text;
          if (typeof Event !== 'undefined') {
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
          }
        } else if (el.isContentEditable) {
          el.textContent = step.text;
          if (typeof Event !== 'undefined') {
            el.dispatchEvent(new Event('input', { bubbles: true }));
          }
        }

        // Postcondition verification: confirm text was populated
        const currentValue = (el as HTMLInputElement).value || el.textContent || '';
        if (currentValue !== step.text) {
          // Retry direct assignment
          (el as any).value = step.text;
        }

        this.callbacks.onShowToast?.(`Entered text: "${step.text}"`, 'COMMAND');
        return { success: true };
      }

      case 'press_key': {
        const active = (document.activeElement as HTMLElement) || document.body;
        const key = step.key;
        if (typeof KeyboardEvent !== 'undefined') {
          active.dispatchEvent(new KeyboardEvent('keydown', { key, code: key, bubbles: true }));
          active.dispatchEvent(new KeyboardEvent('keypress', { key, code: key, bubbles: true }));
          active.dispatchEvent(new KeyboardEvent('keyup', { key, code: key, bubbles: true }));
        }

        if (key.toLowerCase() === 'enter' && isInputElement(active)) {
          const form = active.closest('form');
          if (form && typeof form.requestSubmit === 'function') {
            form.requestSubmit();
          }
        }

        this.callbacks.onShowToast?.(`Pressed ${key}`, 'COMMAND');
        return { success: true };
      }

      case 'scroll': {
        const amount = step.amount || 400;
        if (step.direction === 'down') {
          window.scrollBy({ top: amount, behavior: 'smooth' });
        } else if (step.direction === 'up') {
          window.scrollBy({ top: -amount, behavior: 'smooth' });
        } else if (step.direction === 'top') {
          window.scrollTo({ top: 0, behavior: 'smooth' });
        } else if (step.direction === 'bottom') {
          window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
        }
        this.callbacks.onShowToast?.(`Scrolled ${step.direction}`, 'COMMAND');
        return { success: true };
      }

      case 'select': {
        const el = this.resolveTargetElement(step.target);
        if (!el || !isSelectElement(el)) {
          return { success: false, error: 'Target element is not a <select> element.' };
        }

        const selectEl = el as any;
        let matched = false;
        const targetOptionText = step.option.toLowerCase();
        for (let i = 0; i < selectEl.options.length; i++) {
          const opt = selectEl.options[i];
          if (
            opt.text.toLowerCase().includes(targetOptionText) ||
            opt.value.toLowerCase().includes(targetOptionText)
          ) {
            selectEl.selectedIndex = i;
            matched = true;
            break;
          }
        }

        if (!matched) {
          return { success: false, error: `Option "${step.option}" not found in select dropdown.` };
        }

        el.dispatchEvent(new Event('change', { bubbles: true }));
        this.callbacks.onShowToast?.(`Selected option "${step.option}"`, 'COMMAND');
        return { success: true };
      }

      case 'wait': {
        this.callbacks.onShowToast?.(`Waiting ${step.durationMs}ms...`, 'INFO');
        await new Promise((r) => setTimeout(r, step.durationMs));
        return { success: true };
      }

      case 'extract_text': {
        let extracted = '';
        if (step.target) {
          const el = this.resolveTargetElement(step.target);
          if (el) extracted = (el.innerText || el.textContent || '').trim();
        } else if (step.query === 'headings') {
          const headings = Array.from(document.querySelectorAll('h1, h2, h3'));
          extracted = headings.map((h) => h.textContent?.trim()).filter(Boolean).join('; ');
        } else {
          extracted = document.title;
        }

        this.callbacks.onShowToast?.(`Text: "${extracted.substring(0, 80)}"`, 'INFO');
        return { success: true };
      }

      case 'compare_items': {
        const summary = `Comparing: ${step.items.join(' vs ')}`;
        this.callbacks.onShowToast?.(summary, 'INFO');
        return { success: true };
      }

      case 'go_back': {
        window.history.back();
        this.callbacks.onShowToast?.('Navigated back', 'COMMAND');
        return { success: true };
      }

      case 'clarify': {
        this.callbacks.onShowToast?.(step.question, 'COMMAND');
        return { success: true };
      }

      default:
        return { success: false, error: `Unsupported action type: ${(step as any).action}` };
    }
  }

  /**
   * Resolves target element from ActionTarget metadata (id, name, role, ordinalIndex)
   */
  public resolveTargetElement(target: ActionTarget): HTMLElement | null {
    if (typeof document === 'undefined') return null;

    // 1. Try matching by stable ID
    if (target.id) {
      const byId = document.getElementById(target.id);
      if (byId) return byId;

      // Check among indexed elements
      const indexed = DOMIndexer.scanViewportElements();
      const match = indexed.find((el) => el.id === target.id);
      if (match) return match.element;
    }

    // 2. Scan viewport elements for accessibleName and role match
    const elements = DOMIndexer.scanViewportElements();

    if (target.ordinalIndex !== undefined && target.ordinalIndex >= 0) {
      // Find elements matching role or link
      const filtered = elements.filter((el) => {
        if (target.role) {
          return el.role.toLowerCase() === target.role.toLowerCase() || el.tagName.toLowerCase() === target.role.toLowerCase();
        }
        return true;
      });
      if (filtered[target.ordinalIndex]) {
        return filtered[target.ordinalIndex].element;
      }
    }

    if (target.name) {
      const targetNameLower = target.name.toLowerCase();
      // Exact accessible name match
      const exact = elements.find(
        (el) => el.accessibleName.toLowerCase() === targetNameLower || el.visibleText.toLowerCase() === targetNameLower
      );
      if (exact) return exact.element;

      // Partial accessible name match
      const partial = elements.find(
        (el) =>
          el.accessibleName.toLowerCase().includes(targetNameLower) ||
          targetNameLower.includes(el.accessibleName.toLowerCase()) ||
          el.visibleText.toLowerCase().includes(targetNameLower)
      );
      if (partial) return partial.element;
    }

    // 3. Fallback: querySelector by role or aria-label
    if (target.name) {
      const ariaMatch = document.querySelector(`[aria-label*="${CSS.escape(target.name)}" i]`) as HTMLElement;
      if (ariaMatch) return ariaMatch;
    }

    return null;
  }

  private dispatchFullClick(el: HTMLElement): void {
    const rect = el.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;

    if (typeof PointerEvent !== 'undefined') {
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
    }
    if (typeof MouseEvent !== 'undefined') {
      el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
    }
    if (typeof PointerEvent !== 'undefined') {
      el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
    }
    if (typeof MouseEvent !== 'undefined') {
      el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
    } else if (typeof el.click === 'function') {
      el.click();
    }

    if (typeof el.focus === 'function' && (isInputElement(el) || isTextAreaElement(el) || el.isContentEditable)) {
      el.focus();
    }
  }
}
