/**
 * Handsfree DOM Indexer
 * Scans, extracts, and indexes actionable DOM elements in the active viewport.
 */

import { ActionableElement } from '../../types/intent';
import { PageAccessibilityContext, CompactElementInfo } from '../../types/ai';
import { DwellSafetyGuard } from '../cursor/DwellSafetyGuard';

export class DOMIndexer {
  private static idCounter: number = 0;

  /**
   * Generates a compact, ranked, token-efficient representation of the page DOM
   * and accessibility information for local AI grounding (Qwen2.5).
   */
  public static getCompactPageContext(): PageAccessibilityContext {
    if (typeof document === 'undefined') {
      return {
        url: '',
        title: '',
        headings: [],
        interactiveElements: [],
      };
    }

    const url = window.location.href;
    const title = document.title || '';

    // 1. Extract prominent headings (h1, h2, h3)
    const headingElements = Array.from(document.querySelectorAll('h1, h2, h3'));
    const headings = headingElements
      .map((h) => (h.textContent || '').trim().replace(/\s+/g, ' '))
      .filter((text) => text.length > 0 && text.length < 100)
      .slice(0, 8);

    // 2. Scan visible elements in viewport
    const actionable = DOMIndexer.scanViewportElements();
    const interactiveElements: CompactElementInfo[] = actionable.slice(0, 35).map((act) => {
      const el = act.element;
      let placeholder: string | undefined;
      let inputType: string | undefined;

      if (el instanceof HTMLInputElement) {
        placeholder = el.placeholder || undefined;
        inputType = el.type || 'text';
      } else if (el instanceof HTMLTextAreaElement) {
        placeholder = el.placeholder || undefined;
        inputType = 'textarea';
      }

      return {
        id: act.id,
        tagName: act.tagName,
        role: act.role,
        accessibleName: act.accessibleName,
        placeholder,
        inputType,
        isConsequential: act.isConsequential,
        price: act.price,
      };
    });

    // 3. Extract forms
    const formElements = Array.from(document.querySelectorAll('form'));
    const forms = formElements.slice(0, 3).map((form) => {
      const name = form.getAttribute('name') || form.getAttribute('aria-label') || form.id || 'form';
      const inputs = Array.from(form.querySelectorAll('input:not([type="hidden"]), select, textarea'));
      const fields = inputs
        .map((inp) => {
          const el = inp as HTMLElement;
          return DOMIndexer.computeAccessibleName(el) || el.getAttribute('name') || inp.tagName.toLowerCase();
        })
        .filter(Boolean)
        .slice(0, 6);
      return { name, fields };
    });

    // 4. Products with prices if available
    const productContext = actionable
      .filter((a) => a.price !== undefined)
      .slice(0, 5)
      .map((a) => ({
        title: a.accessibleName || a.visibleText,
        price: a.price,
      }));

    return {
      url,
      title,
      headings,
      interactiveElements,
      forms: forms.length > 0 ? forms : undefined,
      productContext: productContext.length > 0 ? productContext : undefined,
    };
  }

  /**
   * Scans and returns all visible, interactable elements within the current viewport
   */
  public static scanViewportElements(): ActionableElement[] {
    if (typeof document === 'undefined') return [];

    const candidates: ActionableElement[] = [];
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    // Selector covering interactive controls
    const selector = [
      'a[href]',
      'button:not([disabled])',
      'input:not([type="hidden"]):not([disabled])',
      'textarea:not([disabled])',
      'select:not([disabled])',
      '[role="button"]',
      '[role="link"]',
      '[role="tab"]',
      '[role="menuitem"]',
      '[role="checkbox"]',
      '[role="radio"]',
      '[tabindex]:not([tabindex="-1"])',
      'summary',
    ].join(', ');

    const elements = document.querySelectorAll(selector);

    elements.forEach((node) => {
      const el = node as HTMLElement;

      // Filter out our own overlay
      if (el.id === 'handsfree-overlay-root' || el.closest('#handsfree-overlay-root')) {
        return;
      }

      // Check visibility & layout
      const rect = el.getBoundingClientRect();
      if (rect.width <= 4 || rect.height <= 4) return;

      // Check viewport bounds (must intersect current screen)
      if (
        rect.bottom < 0 ||
        rect.top > viewportHeight ||
        rect.right < 0 ||
        rect.left > viewportWidth
      ) {
        return;
      }

      // Check CSS visibility
      const style = window.getComputedStyle(el);
      if (
        style.display === 'none' ||
        style.visibility === 'hidden' ||
        parseFloat(style.opacity) < 0.1 ||
        style.pointerEvents === 'none'
      ) {
        return;
      }

      // Extract accessible metadata
      const accessibleName = DOMIndexer.computeAccessibleName(el);
      const ariaLabel = el.getAttribute('aria-label') || '';
      const visibleText = (el.innerText || el.textContent || '').trim().substring(0, 100);
      const tagName = el.tagName.toLowerCase();
      const role = el.getAttribute('role') || tagName;

      // Extract container context (e.g. nearby heading, form label, or section)
      const containerContext = DOMIndexer.findContainerContext(el);

      // Extract price if present
      const price = DOMIndexer.extractPrice(visibleText || ariaLabel);

      // Check if consequential
      const safetyEval = DwellSafetyGuard.evaluateElement(el);
      const isConsequential = safetyEval.isConsequential;

      const isDisabled =
        el.hasAttribute('disabled') || el.getAttribute('aria-disabled') === 'true';

      DOMIndexer.idCounter++;
      const id = `hf-el-${DOMIndexer.idCounter}`;

      candidates.push({
        id,
        element: el,
        tagName,
        role,
        accessibleName,
        ariaLabel,
        visibleText,
        containerContext,
        rect,
        centerX: rect.left + rect.width / 2,
        centerY: rect.top + rect.height / 2,
        price,
        isConsequential,
        isDisabled,
      });
    });

    return candidates;
  }

  /**
   * Computes human-friendly accessible name per WCAG priority
   */
  public static computeAccessibleName(element: HTMLElement): string {
    // 1. aria-label
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

    // 2. aria-labelledby
    const labelledBy = element.getAttribute('aria-labelledby');
    if (labelledBy) {
      const labelEl = document.getElementById(labelledBy);
      if (labelEl && labelEl.textContent?.trim()) {
        return labelEl.textContent.trim();
      }
    }

    // 3. For inputs: associated <label for="...">
    if (element.id && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT')) {
      const label = document.querySelector(`label[for="${element.id}"]`);
      if (label && label.textContent?.trim()) {
        return label.textContent.trim();
      }
    }

    // 4. placeholder or title
    const placeholder = element.getAttribute('placeholder');
    if (placeholder && placeholder.trim()) return placeholder.trim();

    const title = element.getAttribute('title');
    if (title && title.trim()) return title.trim();

    // 5. Image alt inside control
    const img = element.querySelector('img[alt]');
    if (img) {
      const alt = img.getAttribute('alt');
      if (alt && alt.trim()) return alt.trim();
    }

    // 6. Direct text content
    const text = (element.innerText || element.textContent || '').trim();
    if (text) {
      // Avoid enormous text blocks
      return text.substring(0, 80).replace(/\s+/g, ' ');
    }

    // 7. Value attribute for inputs
    if (element instanceof HTMLInputElement && element.value) {
      return element.value.trim();
    }

    return '';
  }

  /**
   * Find nearby heading or container context for disambiguation
   */
  private static findContainerContext(element: HTMLElement): string {
    let current: HTMLElement | null = element.parentElement;
    while (current && current !== document.body) {
      // Look for heading preceding or within parent
      const heading = current.querySelector('h1, h2, h3, h4, h5, h6');
      if (heading && heading !== element && heading.textContent?.trim()) {
        return heading.textContent.trim().substring(0, 50);
      }
      current = current.parentElement;
    }
    return '';
  }

  /**
   * Parses monetary value from text (e.g. "$19.99", "USD 45", "€29")
   */
  public static extractPrice(text: string): number | undefined {
    if (!text) return undefined;
    const match = text.match(/[$€£₹¥]\s*([0-9]+(?:[.,][0-9]{2})?)/);
    if (match && match[1]) {
      const parsed = parseFloat(match[1].replace(',', '.'));
      if (!isNaN(parsed)) return parsed;
    }
    return undefined;
  }
}
