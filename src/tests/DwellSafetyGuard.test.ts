import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { DwellSafetyGuard } from '../core/cursor/DwellSafetyGuard';

// Lightweight DOM mock for Node.js test environment
class MockHTMLElement {
  public id: string = '';
  public className: string = '';
  public textContent: string = '';
  public tagName: string = 'DIV';
  public parentElement: MockHTMLElement | null = null;
  public attributes: Record<string, string> = {};
  public isContentEditable: boolean = false;
  public onclick: any = null;

  constructor(tagName: string = 'DIV') {
    this.tagName = tagName.toUpperCase();
  }

  public getAttribute(name: string): string | null {
    return this.attributes[name] ?? null;
  }

  public setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  public hasAttribute(name: string): boolean {
    return name in this.attributes;
  }

  public closest(selector: string): MockHTMLElement | null {
    if (selector === '#handsfree-overlay-root') {
      let cur: MockHTMLElement | null = this;
      while (cur) {
        if (cur.id === 'handsfree-overlay-root') return cur;
        cur = cur.parentElement;
      }
      return null;
    }
    return null;
  }

  public appendChild(child: MockHTMLElement): MockHTMLElement {
    child.parentElement = this;
    return child;
  }

  public remove(): void {
    this.parentElement = null;
  }
}

class MockHTMLInputElement extends MockHTMLElement {
  public type: string = 'text';
  public value: string = '';
  constructor() {
    super('INPUT');
  }
}

describe('DwellSafetyGuard', () => {
  let guard: DwellSafetyGuard;

  beforeAll(() => {
    (globalThis as any).HTMLElement = MockHTMLElement;
    (globalThis as any).HTMLInputElement = MockHTMLInputElement;
    (globalThis as any).document = {
      body: new MockHTMLElement('BODY'),
      documentElement: new MockHTMLElement('HTML'),
      createElement(tag: string) {
        if (tag.toLowerCase() === 'input') return new MockHTMLInputElement();
        return new MockHTMLElement(tag);
      },
      contains(node: any) {
        let cur = node;
        while (cur) {
          if (cur === (globalThis as any).document.body) return true;
          cur = cur.parentElement;
        }
        return false;
      },
    };
  });

  beforeEach(() => {
    guard = new DwellSafetyGuard();
    (globalThis as any).document.body = new MockHTMLElement('BODY');
  });

  describe('evaluateElement', () => {
    it('rejects null or non-interactive elements', () => {
      expect(DwellSafetyGuard.evaluateElement(null).isClickable).toBe(false);

      const div = (document.createElement('div') as unknown) as HTMLElement;
      div.textContent = 'Just plain static text';
      document.body.appendChild(div);

      const res = DwellSafetyGuard.evaluateElement(div);
      expect(res.isClickable).toBe(false);
      expect(res.isConsequential).toBe(false);
    });

    it('rejects handsfree overlay elements', () => {
      const overlayRoot = (document.createElement('div') as unknown) as HTMLElement;
      overlayRoot.id = 'handsfree-overlay-root';
      const overlayBtn = (document.createElement('button') as unknown) as HTMLElement;
      overlayBtn.textContent = 'Pause';
      overlayRoot.appendChild(overlayBtn);
      document.body.appendChild(overlayRoot);

      const res = DwellSafetyGuard.evaluateElement(overlayBtn);
      expect(res.isClickable).toBe(false);
    });

    it('approves low-risk standard interactive elements', () => {
      const link = (document.createElement('a') as unknown) as HTMLElement;
      link.setAttribute('href', '#');
      link.textContent = 'Read Wikipedia article';
      document.body.appendChild(link);

      const resLink = DwellSafetyGuard.evaluateElement(link);
      expect(resLink.isClickable).toBe(true);
      expect(resLink.isConsequential).toBe(false);

      const btn = (document.createElement('button') as unknown) as HTMLElement;
      btn.textContent = 'Next Chapter';
      document.body.appendChild(btn);

      const resBtn = DwellSafetyGuard.evaluateElement(btn);
      expect(resBtn.isClickable).toBe(true);
      expect(resBtn.isConsequential).toBe(false);

      const textInput = (document.createElement('input') as unknown) as HTMLInputElement;
      textInput.type = 'text';
      document.body.appendChild(textInput);

      const resInput = DwellSafetyGuard.evaluateElement(textInput);
      expect(resInput.isClickable).toBe(true);
      expect(resInput.isConsequential).toBe(false);
    });

    it('identifies consequential and destructive action buttons', () => {
      const deleteBtn = (document.createElement('button') as unknown) as HTMLElement;
      deleteBtn.textContent = 'Delete Project Permanently';
      document.body.appendChild(deleteBtn);

      const resDelete = DwellSafetyGuard.evaluateElement(deleteBtn);
      expect(resDelete.isClickable).toBe(true);
      expect(resDelete.isConsequential).toBe(true);
      expect(resDelete.reason).toContain('Consequential action detected');

      const buyBtn = (document.createElement('button') as unknown) as HTMLElement;
      buyBtn.setAttribute('aria-label', 'Confirm and buy subscription now');
      document.body.appendChild(buyBtn);

      const resBuy = DwellSafetyGuard.evaluateElement(buyBtn);
      expect(resBuy.isConsequential).toBe(true);

      const logoutLink = (document.createElement('a') as unknown) as HTMLElement;
      logoutLink.setAttribute('href', '/logout');
      logoutLink.textContent = 'Sign out';
      document.body.appendChild(logoutLink);

      const resLogout = DwellSafetyGuard.evaluateElement(logoutLink);
      expect(resLogout.isConsequential).toBe(true);

      const submitInput = (document.createElement('input') as unknown) as HTMLInputElement;
      submitInput.type = 'submit';
      submitInput.value = 'Submit Transaction';
      document.body.appendChild(submitInput);

      const resSubmit = DwellSafetyGuard.evaluateElement(submitInput);
      expect(resSubmit.isConsequential).toBe(true);
    });
  });

  describe('updateTarget and dwell tracking', () => {
    it('allows dwell start on safe interactive element', () => {
      const btn = (document.createElement('button') as unknown) as HTMLElement;
      btn.textContent = 'Next Page';
      document.body.appendChild(btn);

      const allowed = guard.updateTarget(btn, 1000);
      expect(allowed).toBe(true);
      expect(guard.getActiveTarget()).toBe(btn);
      expect(guard.isConsequential()).toBe(false);
    });

    it('blocks dwell and returns false on consequential targets', () => {
      const btn = (document.createElement('button') as unknown) as HTMLElement;
      btn.textContent = 'Delete account';
      document.body.appendChild(btn);

      const allowed = guard.updateTarget(btn, 1000);
      expect(allowed).toBe(false);
      expect(guard.getActiveTarget()).toBe(btn);
      expect(guard.isConsequential()).toBe(true);
    });

    it('resets dwell when target changes', () => {
      const btn1 = (document.createElement('button') as unknown) as HTMLElement;
      btn1.textContent = 'First';
      const btn2 = (document.createElement('button') as unknown) as HTMLElement;
      btn2.textContent = 'Second';
      document.body.appendChild(btn1);
      document.body.appendChild(btn2);

      guard.updateTarget(btn1, 1000);
      expect(guard.getActiveTarget()).toBe(btn1);

      // User moves cursor to btn2
      const allowed2 = guard.updateTarget(btn2, 1100);
      expect(allowed2).toBe(true);
      expect(guard.getActiveTarget()).toBe(btn2);
    });

    it('cancels dwell when cursor leaves interactive target to background', () => {
      const btn = (document.createElement('button') as unknown) as HTMLElement;
      btn.textContent = 'First';
      const bg = (document.createElement('div') as unknown) as HTMLElement;
      document.body.appendChild(btn);
      document.body.appendChild(bg);

      guard.updateTarget(btn, 1000);
      expect(guard.getActiveTarget()).toBe(btn);

      const allowed = guard.updateTarget(bg, 1100);
      expect(allowed).toBe(false);
      expect(guard.getActiveTarget()).toBeNull();
    });
  });

  describe('revalidateBeforeActivation', () => {
    it('successfully validates attached matching low-risk target', () => {
      const btn = (document.createElement('button') as unknown) as HTMLElement;
      btn.textContent = 'Confirm Choice';
      document.body.appendChild(btn);

      guard.updateTarget(btn, 1000);
      const target = guard.revalidateBeforeActivation(btn);
      expect(target).toBe(btn);
      // After activation, state resets
      expect(guard.getActiveTarget()).toBeNull();
    });

    it('rejects activation if target was removed from the DOM before timer completed', () => {
      const btn = (document.createElement('button') as unknown) as HTMLElement;
      btn.textContent = 'Ephemeral Button';
      document.body.appendChild(btn);

      guard.updateTarget(btn, 1000);

      // Dynamic page removes button before dwell fires
      btn.remove();

      const target = guard.revalidateBeforeActivation(btn);
      expect(target).toBeNull();
    });

    it('rejects activation if cursor moved onto a different element before timer completion', () => {
      const btn1 = (document.createElement('button') as unknown) as HTMLElement;
      btn1.textContent = 'Btn 1';
      const btn2 = (document.createElement('button') as unknown) as HTMLElement;
      btn2.textContent = 'Btn 2';
      document.body.appendChild(btn1);
      document.body.appendChild(btn2);

      guard.updateTarget(btn1, 1000);

      // Revalidation check at point where btn2 is now located
      const target = guard.revalidateBeforeActivation(btn2);
      expect(target).toBeNull();
    });

    it('never validates a consequential target', () => {
      const btn = (document.createElement('button') as unknown) as HTMLElement;
      btn.textContent = 'Purchase $99.99';
      document.body.appendChild(btn);

      guard.updateTarget(btn, 1000);
      const target = guard.revalidateBeforeActivation(btn);
      expect(target).toBeNull();
    });
  });
});
