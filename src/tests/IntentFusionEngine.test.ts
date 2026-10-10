import { describe, it, expect, beforeEach, beforeAll } from 'vitest';
import { IntentFusionEngine } from '../core/intent/IntentFusionEngine';
import { IntentShadow } from '../core/intent/IntentShadow';
import { ActionableElement } from '../types/intent';

class MockElement {
  getBoundingClientRect() {
    return { width: 100, height: 40, left: 0, top: 0, right: 100, bottom: 40 };
  }
  getAttribute(_name: string) {
    return null;
  }
}

describe('IntentFusionEngine', () => {
  let shadow: IntentShadow;

  beforeAll(() => {
    (globalThis as any).document = {
      contains: () => true,
    };
  });

  beforeEach(() => {
    shadow = new IntentShadow(5000);
  });

  const createElement = (id: string, name: string, isConsequential: boolean = false): ActionableElement => ({
    id,
    element: new MockElement() as any,
    tagName: 'button',
    role: 'button',
    accessibleName: name,
    ariaLabel: name,
    visibleText: name,
    rect: { width: 100, height: 40, left: 100, top: 100, right: 200, bottom: 140 } as any,
    centerX: 150,
    centerY: 120,
    isConsequential,
    isDisabled: false,
  });

  it('yields PAUSE when system is paused or tracking is lost', () => {
    const decision = IntentFusionEngine.fuse({
      command: { type: 'SCROLL_DOWN', rawText: 'scroll down' },
      cursorX: 100,
      cursorY: 100,
      isTrackingStable: true,
      trackingLost: false,
      isPaused: true,
      indexedElements: [],
      intentShadow: shadow,
    });
    expect(decision.outcome).toBe('PAUSE');

    const lostDecision = IntentFusionEngine.fuse({
      command: { type: 'SCROLL_DOWN', rawText: 'scroll down' },
      cursorX: 100,
      cursorY: 100,
      isTrackingStable: false,
      trackingLost: true,
      isPaused: false,
      indexedElements: [],
      intentShadow: shadow,
    });
    expect(lostDecision.outcome).toBe('PAUSE');
  });

  it('yields EXECUTE for low-risk direct system commands', () => {
    const decision = IntentFusionEngine.fuse({
      command: { type: 'SCROLL_DOWN', rawText: 'scroll down' },
      cursorX: 100,
      cursorY: 100,
      isTrackingStable: true,
      trackingLost: false,
      isPaused: false,
      indexedElements: [],
      intentShadow: shadow,
    });
    expect(decision.outcome).toBe('EXECUTE');
    expect(decision.riskLevel).toBe('LOW');
  });

  it('yields EXECUTE for unambiguous low-risk semantic target', () => {
    const btn = createElement('1', 'View Details');
    const decision = IntentFusionEngine.fuse({
      command: { type: 'CLICK_TARGET', rawText: 'click View Details', targetQuery: 'View Details' },
      cursorX: 150,
      cursorY: 120,
      isTrackingStable: true,
      trackingLost: false,
      isPaused: false,
      indexedElements: [btn],
      intentShadow: shadow,
    });
    expect(decision.outcome).toBe('EXECUTE');
    expect(decision.target?.id).toBe('1');
  });

  it('yields CLARIFY when multiple candidates match query ambiguously', () => {
    const optA = createElement('1', 'Option Alpha');
    const optB = createElement('2', 'Option Beta');

    const decision = IntentFusionEngine.fuse({
      command: { type: 'CLICK_TARGET', rawText: 'select Option', targetQuery: 'Option' },
      cursorX: 100,
      cursorY: 100,
      isTrackingStable: true,
      trackingLost: false,
      isPaused: false,
      indexedElements: [optA, optB],
      intentShadow: shadow,
    });

    expect(decision.outcome).toBe('CLARIFY');
    expect(decision.candidates?.length).toBe(2);
  });

  it('yields CONFIRM when candidate is high-risk (consequential delete/purchase)', () => {
    const deleteBtn = createElement('del', 'Delete My Account', true);

    const decision = IntentFusionEngine.fuse({
      command: { type: 'CLICK_TARGET', rawText: 'click delete my account', targetQuery: 'Delete My Account' },
      cursorX: 150,
      cursorY: 120,
      isTrackingStable: true,
      trackingLost: false,
      isPaused: false,
      indexedElements: [deleteBtn],
      intentShadow: shadow,
    });

    expect(decision.outcome).toBe('CONFIRM');
    expect(decision.riskLevel).toBe('HIGH');
    expect(decision.target?.id).toBe('del');
  });

  it('executes high-risk target when user explicitly confirms', () => {
    const deleteBtn = createElement('del', 'Delete Project', true);

    const decision = IntentFusionEngine.fuse({
      command: { type: 'CONFIRM', rawText: 'confirm' },
      cursorX: 150,
      cursorY: 120,
      isTrackingStable: true,
      trackingLost: false,
      isPaused: false,
      indexedElements: [deleteBtn],
      intentShadow: shadow,
      pendingConfirmationTarget: deleteBtn,
    });

    expect(decision.outcome).toBe('EXECUTE');
    expect(decision.target?.id).toBe('del');
  });
});
