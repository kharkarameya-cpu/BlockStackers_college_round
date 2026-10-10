import { CursorEngine } from '../core/cursor/CursorEngine';
import { OverlayRenderer } from './overlay/OverlayRenderer';
import { SettingsService } from '../core/storage/SettingsService';
import { ExtensionMessage } from '../types/messages';
import { DwellSafetyGuard } from '../core/cursor/DwellSafetyGuard';
import { SpeechController } from '../core/speech/SpeechController';
import { DictationController } from '../core/speech/DictationController';
import { DOMIndexer } from '../core/semantic/DOMIndexer';
import { IntentShadow } from '../core/intent/IntentShadow';
import { IntentFusionEngine } from '../core/intent/IntentFusionEngine';
import { SafetyPolicy } from '../core/safety/SafetyPolicy';
import { ActionRewind } from '../core/recovery/ActionRewind';
import { MagneticCursor } from '../core/cursor/MagneticCursor';
import { AdaptiveEffortEngine } from '../core/adaptation/AdaptiveEffortEngine';
import { MetricsService } from '../core/metrics/MetricsService';
import { ActionableElement, ParsedVoiceCommand } from '../types/intent';
import { IntentLearningEngine } from '../core/ai/IntentLearningEngine';
import { BrowserActionExecutor } from '../core/intent/BrowserActionExecutor';
import { ActionPlan } from '../types/ai';
import { AudioLogger } from '../core/speech/AudioLogger';

// Only run on the top-level window (never in ads or subframes on Google, etc.)
if (typeof window !== 'undefined' && window === window.top) {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initContentScript().catch((err) => console.warn('[Handsfree] Content script init note:', err));
    });
  } else {
    initContentScript().catch((err) => console.warn('[Handsfree] Content script init note:', err));
  }
}

function isExtensionValid(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id);
}

function safeSendMessage(message: ExtensionMessage): void {
  if (isExtensionValid()) {
    try {
      chrome.runtime.sendMessage(message).catch(() => {
        // Ignored if service worker asleep or tab disconnected
      });
    } catch {
      // Ignored
    }
  }
}

async function initContentScript() {
  const profile = await SettingsService.getCalibrationProfile();
  const filterParams = await SettingsService.getFilterParams();
  let isPaused = await SettingsService.getIsPaused();

  // Core Subsystems
  const cursorEngine = new CursorEngine(profile, filterParams);
  cursorEngine.setPaused(isPaused);

  const safetyGuard = new DwellSafetyGuard();
  const intentShadow = new IntentShadow(8000);
  const actionRewind = new ActionRewind(25);
  const magneticCursor = new MagneticCursor({ enabled: true, attractionRadiusPx: 36, attractionStrength: 0.3 });
  const adaptiveEffort = new AdaptiveEffortEngine(true);

  let pendingConfirmationTarget: ActionableElement | null = null;
  let lastCursorX = window.innerWidth / 2;
  let lastCursorY = window.innerHeight / 2;
  let isTrackingStable = true;
  let trackingLost = false;

  const overlay = new OverlayRenderer({
    onTogglePause: async () => {
      isPaused = !isPaused;
      cursorEngine.setPaused(isPaused);
      browserActionExecutor.setPaused(isPaused);
      safetyGuard.cancelDwell();
      overlay.clearCandidates();
      overlay.clearConfirmationPrompt();
      overlay.clearActionPlan();
      await SettingsService.setIsPaused(isPaused);
      safeSendMessage({ type: 'TOGGLE_PAUSE', paused: isPaused });
    },
    onRecenter: () => {
      cursorEngine.recenter();
      safetyGuard.cancelDwell();
      adaptiveEffort.recordRecentering();
    },
  });

  const browserActionExecutor = new BrowserActionExecutor({
    onStepProgress: (stepIndex, totalSteps, step) => {
      overlay.updateActionPlanStep(stepIndex, totalSteps, `${step.action}`);
      overlay.showVoiceToast(`[${stepIndex}/${totalSteps}] ${step.action}`, 'COMMAND');
    },
    onPlanComplete: (plan) => {
      overlay.clearActionPlan();
      overlay.showVoiceToast(plan.reason || 'Plan completed', 'COMMAND');
    },
    onPlanFailed: (err) => {
      overlay.clearActionPlan();
      overlay.showVoiceToast(err, 'ERROR');
    },
    onRequiresConfirmation: (step, targetEl, onConfirm, onReject) => {
      if (targetEl) {
        const actionableTarget: ActionableElement = {
          id: targetEl.id || 'confirm-tgt',
          element: targetEl,
          tagName: targetEl.tagName.toLowerCase(),
          role: targetEl.getAttribute('role') || targetEl.tagName.toLowerCase(),
          accessibleName: DOMIndexer.computeAccessibleName(targetEl),
          ariaLabel: targetEl.getAttribute('aria-label') || '',
          visibleText: (targetEl.innerText || '').substring(0, 50),
          rect: targetEl.getBoundingClientRect(),
          centerX: targetEl.getBoundingClientRect().left + targetEl.getBoundingClientRect().width / 2,
          centerY: targetEl.getBoundingClientRect().top + targetEl.getBoundingClientRect().height / 2,
          isConsequential: true,
          isDisabled: false,
        };
        overlay.showConfirmationPrompt(actionableTarget, onConfirm, onReject);
      } else {
        const confirmed = window.confirm(`Handsfree: Confirm consequential action "${step.action}"?`);
        if (confirmed) onConfirm();
        else onReject();
      }
    },
    onShowToast: (msg, type) => {
      overlay.showVoiceToast(msg, type);
    },
  });

  // Cancel dwell on page scroll or viewport resize
  window.addEventListener(
    'scroll',
    () => {
      cursorEngine.resetDwell();
      safetyGuard.cancelDwell();
      overlay.clearCandidates();
      adaptiveEffort.recordAbortedDwell();
    },
    { passive: true }
  );

  window.addEventListener(
    'resize',
    () => {
      cursorEngine.resetDwell();
      safetyGuard.cancelDwell();
      overlay.clearCandidates();
    },
    { passive: true }
  );

  // Initialize Speech Controller
  const speechController = new SpeechController({
    onCommand: (command: ParsedVoiceCommand) => {
      handleVoiceCommand(command);
    },
    onDictationText: (text: string) => {
      handleDictation(text);
    },
    onStateChange: (isListening, mode) => {
      overlay.setMode(mode === 'DICTATE' ? 'DICTATE' : isListening ? 'LISTEN' : 'POINT');
    },
    onError: (err) => {
      overlay.showVoiceToast(err, 'ERROR');
    },
  });

  // Automatically start listening if supported
  if (speechController.getIsSupported()) {
    speechController.start();
  }

  // Connect cursor engine to overlay renderer & safety guard
  cursorEngine.setListeners(
    (cursorState) => {
      lastCursorX = cursorState.x;
      lastCursorY = cursorState.y;
      isTrackingStable = !cursorState.trackingLost && cursorState.trackingState === 'TRACKING';
      trackingLost = cursorState.trackingLost;

      // Optional Magnetic Cursor Attraction
      let displayX = cursorState.x;
      let displayY = cursorState.y;

      if (!cursorState.isPaused && !cursorState.trackingLost) {
        const visibleElements = DOMIndexer.scanViewportElements();
        const magneticResult = magneticCursor.applyMagneticPull(cursorState.x, cursorState.y, visibleElements);
        displayX = magneticResult.x;
        displayY = magneticResult.y;

        // Register hovered element in IntentShadow
        if (magneticResult.nearestElement) {
          intentShadow.registerHypothesis(magneticResult.nearestElement, 'CURSOR_HOVER');
        }
      }

      overlay.updateCursor({
        ...cursorState,
        x: displayX,
        y: displayY,
      });

      // Verify target stability and consequential safety during hover
      if (
        !cursorState.isPaused &&
        !cursorState.trackingLost &&
        cursorState.trackingState === 'TRACKING'
      ) {
        const elementUnderCursor = document.elementFromPoint(
          displayX,
          displayY
        ) as HTMLElement | null;

        const isAllowed = safetyGuard.updateTarget(elementUnderCursor, performance.now());
        if (!isAllowed && cursorState.isDwelling) {
          cursorEngine.resetDwell();
          adaptiveEffort.recordAbortedDwell();
        }
      } else {
        safetyGuard.cancelDwell();
      }
    },
    (clickX, clickY) => {
      // Dwell timer completion: Re-validate target immediately before activation
      const currentPointElement = document.elementFromPoint(clickX, clickY) as HTMLElement | null;
      const verifiedTarget = safetyGuard.revalidateBeforeActivation(currentPointElement);

      if (verifiedTarget) {
        // Double check with SafetyPolicy: Dwell alone must NEVER execute high-risk actions
        const targetElementInfo: ActionableElement = {
          id: 'dwell-tgt',
          element: verifiedTarget,
          tagName: verifiedTarget.tagName.toLowerCase(),
          role: verifiedTarget.getAttribute('role') || verifiedTarget.tagName.toLowerCase(),
          accessibleName: DOMIndexer.computeAccessibleName(verifiedTarget),
          ariaLabel: verifiedTarget.getAttribute('aria-label') || '',
          visibleText: verifiedTarget.innerText || '',
          rect: verifiedTarget.getBoundingClientRect(),
          centerX: clickX,
          centerY: clickY,
          isConsequential: false,
          isDisabled: false,
        };

        const safetyCheck = SafetyPolicy.validateExecutionSafety(targetElementInfo, 'DWELL');
        if (safetyCheck.permitted) {
          overlay.showClickRipple(clickX, clickY);
          executeElementClick(verifiedTarget, clickX, clickY);
          adaptiveEffort.recordSuccessfulClick();
          MetricsService.recordTaskEvent(true, profile.dwellDurationMs, 'DWELL').catch(() => {});
        } else {
          cursorEngine.resetDwell();
          overlay.showVoiceToast('Dwell blocked: High-risk action', 'ERROR');
        }
      } else {
        cursorEngine.resetDwell();
      }
    },
    (gesture, x, y) => {
      handleHandGesture(gesture, x, y);
    }
  );

  // Immediately display cursor in center of viewport
  overlay.updateCursor({
    ...cursorEngine.getCurrentState(),
    x: lastCursorX,
    y: lastCursorY,
  });

  // Request vision tracking session to ensure offscreen host is running
  safeSendMessage({ type: 'START_TRACKING' });

  let lastGestureTriggerTime = 0;
  function handleHandGesture(gesture: any, x: number, y: number) {
    const now = performance.now();
    if (now - lastGestureTriggerTime < 500 && gesture !== 'TWO_FINGERS') return;

    if (gesture === 'DOUBLE_PINCH') {
      lastGestureTriggerTime = now;
      const el = document.elementFromPoint(x, y) as HTMLElement | null;
      if (el) {
        overlay.showVoiceToast('Double Click', 'COMMAND');
        el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
      }
    } else if (gesture === 'TWO_FINGERS') {
      window.scrollBy({ top: 100, behavior: 'smooth' });
    } else if (gesture === 'THREE_FINGERS') {
      lastGestureTriggerTime = now;
      handleVoiceCommand({ type: 'SHOW_CHOICES', rawText: 'Show labels' });
    } else if (gesture === 'THUMBS_UP') {
      lastGestureTriggerTime = now;
      handleVoiceCommand({ type: 'CONFIRM', rawText: 'Confirm' });
    } else if (gesture === 'THUMBS_DOWN') {
      lastGestureTriggerTime = now;
      handleVoiceCommand({ type: 'CANCEL', rawText: 'Cancel' });
    }
  }

  let lastSpokenUtterance = '';

  /**
   * Voice Command Handler
   */
  async function handleVoiceCommand(cmd: ParsedVoiceCommand) {
    lastSpokenUtterance = cmd.rawText;
    overlay.showVoiceToast(cmd.rawText, 'COMMAND');
    AudioLogger.getInstance().logExecution(cmd.type, true, { command: cmd, rawText: cmd.rawText });

    // 0A. Structured Action Plan from Qwen2.5 Local AI
    if (cmd.actionPlan) {
      const plan = cmd.actionPlan as ActionPlan;
      overlay.showActionPlan(plan.reason, plan.steps.length, () => {
        browserActionExecutor.cancel();
      });

      const execResult = await browserActionExecutor.executePlan(plan);
      overlay.clearActionPlan();

      if (execResult.success) {
        IntentLearningEngine.getInstance().recordSuccess(cmd.rawText, cmd.sequence || []);
      }
      return;
    }

    // 0B. Compound Sequence of Actions (from Local AI / Qwen decomposition)
    if (cmd.type === 'COMPOUND_SEQUENCE' && cmd.sequence && cmd.sequence.length > 0) {
      overlay.showVoiceToast(`Decomposing: ${cmd.sequence.length} actions`, 'COMMAND');
      for (let i = 0; i < cmd.sequence.length; i++) {
        const sub = cmd.sequence[i];
        await handleVoiceCommand(sub);
        if (i < cmd.sequence.length - 1) {
          await new Promise((r) => setTimeout(r, 320));
        }
      }
      IntentLearningEngine.getInstance().recordSuccess(cmd.rawText, cmd.sequence);
      return;
    }

    // 0B. Direct Text Typing ("type hello world")
    if (cmd.type === 'TYPE_TEXT') {
      const textToType = cmd.text || '';
      const activeEl = document.activeElement as HTMLElement | null;
      const prevVal = (activeEl as HTMLInputElement)?.value;
      const res = DictationController.insertText(textToType);
      if (res.success) {
        overlay.showVoiceToast(`Typed: "${textToType}"`, 'DICTATE');
        actionRewind.recordAction({
          type: 'TEXT_INPUT',
          targetElement: activeEl || undefined,
          previousValue: prevVal,
          description: `Type "${textToType}"`,
          undo: () => {
            if (activeEl && prevVal !== undefined) {
              (activeEl as HTMLInputElement).value = prevVal;
              return true;
            }
            return false;
          },
        });
        IntentLearningEngine.getInstance().recordSuccess(cmd.rawText, [cmd]);
      } else {
        overlay.showVoiceToast(res.error || 'Focus an input first', 'ERROR');
      }
      return;
    }

    // 0C. Press Enter
    if (cmd.type === 'PRESS_ENTER') {
      const activeEl = document.activeElement as HTMLElement | null;
      if (activeEl) {
        activeEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        activeEl.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        activeEl.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        const form = activeEl.closest('form');
        if (form && typeof form.requestSubmit === 'function') {
          form.requestSubmit();
        }
        overlay.showVoiceToast('Pressed Enter', 'COMMAND');
      }
      IntentLearningEngine.getInstance().recordSuccess(cmd.rawText, [cmd]);
      return;
    }

    // 0D. Open Settings
    if (cmd.type === 'OPEN_SETTINGS') {
      if (typeof chrome !== 'undefined' && chrome.runtime?.openOptionsPage) {
        chrome.runtime.openOptionsPage();
      } else {
        window.open(chrome.runtime.getURL('options.html'), '_blank');
      }
      overlay.showVoiceToast('Opening Settings', 'COMMAND');
      return;
    }

    // 0E. Teach Alias
    if (cmd.type === 'TEACH_ALIAS') {
      if (typeof chrome !== 'undefined' && chrome.runtime?.openOptionsPage) {
        chrome.runtime.openOptionsPage();
      } else {
        window.open(chrome.runtime.getURL('options.html'), '_blank');
      }
      overlay.showVoiceToast('Manage phrase aliases in Settings > AI Brain', 'COMMAND');
      return;
    }

    // 0F. Direct Cursor Actions ("click", "double click", "recenter")
    if (cmd.type === 'CLICK') {
      const el = document.elementFromPoint(lastCursorX, lastCursorY) as HTMLElement | null;
      if (el) {
        overlay.showClickRipple(lastCursorX, lastCursorY);
        executeElementClick(el, lastCursorX, lastCursorY);
        overlay.showVoiceToast('Click', 'COMMAND');
      }
      return;
    }

    if (cmd.type === 'DOUBLE_CLICK') {
      const el = document.elementFromPoint(lastCursorX, lastCursorY) as HTMLElement | null;
      if (el) {
        overlay.showClickRipple(lastCursorX, lastCursorY);
        el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, clientX: lastCursorX, clientY: lastCursorY }));
        overlay.showVoiceToast('Double Click', 'COMMAND');
      }
      return;
    }

    if (cmd.type === 'RECENTER_CURSOR') {
      cursorEngine.recenter();
      overlay.showVoiceToast('Cursor Recentered', 'COMMAND');
      return;
    }

    // 1. Reversible Scroll Commands
    if (cmd.type === 'SCROLL_DOWN') {
      const prevY = window.scrollY;
      window.scrollBy({ top: 400, behavior: 'smooth' });
      actionRewind.recordAction({
        type: 'SCROLL',
        previousValue: prevY,
        description: 'Scroll Down',
        undo: () => {
          window.scrollTo({ top: prevY, behavior: 'smooth' });
          return true;
        },
      });
      MetricsService.recordTaskEvent(true, 100, 'VOICE').catch(() => {});
      return;
    }

    if (cmd.type === 'SCROLL_UP') {
      const prevY = window.scrollY;
      window.scrollBy({ top: -400, behavior: 'smooth' });
      actionRewind.recordAction({
        type: 'SCROLL',
        previousValue: prevY,
        description: 'Scroll Up',
        undo: () => {
          window.scrollTo({ top: prevY, behavior: 'smooth' });
          return true;
        },
      });
      MetricsService.recordTaskEvent(true, 100, 'VOICE').catch(() => {});
      return;
    }

    if (cmd.type === 'SCROLL_TOP') {
      const prevY = window.scrollY;
      window.scrollTo({ top: 0, behavior: 'smooth' });
      actionRewind.recordAction({
        type: 'SCROLL',
        previousValue: prevY,
        description: 'Scroll to Top',
        undo: () => {
          window.scrollTo({ top: prevY, behavior: 'smooth' });
          return true;
        },
      });
      return;
    }

    if (cmd.type === 'SCROLL_BOTTOM') {
      const prevY = window.scrollY;
      window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
      actionRewind.recordAction({
        type: 'SCROLL',
        previousValue: prevY,
        description: 'Scroll to Bottom',
        undo: () => {
          window.scrollTo({ top: prevY, behavior: 'smooth' });
          return true;
        },
      });
      return;
    }

    // 2. Navigation Commands
    if (cmd.type === 'NAVIGATE_BACK') {
      window.history.back();
      return;
    }
    if (cmd.type === 'NAVIGATE_FORWARD') {
      window.history.forward();
      return;
    }
    if (cmd.type === 'REFRESH_PAGE') {
      window.location.reload();
      return;
    }

    // 3. Reversible Action Rewind / Undo That
    if (cmd.type === 'UNDO') {
      if (lastSpokenUtterance) {
        IntentLearningEngine.getInstance().recordUndo(lastSpokenUtterance);
      }
      const undoResult = await actionRewind.undoLastAction();
      if (undoResult.success) {
        overlay.showVoiceToast(undoResult.description || 'Undone', 'COMMAND');
        MetricsService.recordTaskEvent(true, 50, 'UNDO').catch(() => {});
      } else {
        overlay.showVoiceToast(undoResult.error || 'Nothing to undo', 'ERROR');
      }
      return;
    }

    // 4. Cancel Command
    if (cmd.type === 'CANCEL') {
      browserActionExecutor.cancel();
      overlay.clearActionPlan();
      overlay.clearCandidates();
      overlay.clearConfirmationPrompt();
      pendingConfirmationTarget = null;
      cursorEngine.resetDwell();
      overlay.showVoiceToast('Cancelled', 'COMMAND');
      return;
    }

    // 5. Show Choices (Overview of actionable elements)
    if (cmd.type === 'SHOW_CHOICES') {
      const visible = DOMIndexer.scanViewportElements().slice(0, 5);
      const matches = visible.map((el, i) => ({
        candidate: el,
        score: 1.0 - i * 0.1,
        matchType: 'CONTEXTUAL' as const,
        explanation: `Candidate #${i + 1}`,
      }));
      overlay.showCandidates(matches, (chosen) => {
        overlay.clearCandidates();
        executeElementClick(chosen.element, chosen.centerX, chosen.centerY);
      });
      return;
    }

    // 6. Multimodal Intent Fusion (Pointer + Spoken Intent + Context + Safety)
    const elements = DOMIndexer.scanViewportElements();
    const decision = IntentFusionEngine.fuse({
      command: cmd,
      cursorX: lastCursorX,
      cursorY: lastCursorY,
      isTrackingStable,
      trackingLost,
      isPaused,
      indexedElements: elements,
      intentShadow,
      pendingConfirmationTarget,
    });

    switch (decision.outcome) {
      case 'EXECUTE': {
        if (!decision.target) return;
        overlay.clearCandidates();
        overlay.clearConfirmationPrompt();
        pendingConfirmationTarget = null;

        if (cmd.type === 'FOCUS_INPUT') {
          DictationController.focusElement(decision.target.element);
          overlay.showVoiceToast(`Focused "${decision.target.accessibleName}"`, 'COMMAND');
        } else {
          overlay.showClickRipple(decision.target.centerX, decision.target.centerY);
          executeElementClick(decision.target.element, decision.target.centerX, decision.target.centerY);
          IntentLearningEngine.getInstance().recordSuccess(cmd.rawText, [cmd]);
          MetricsService.recordTaskEvent(true, 120, 'VOICE').catch(() => {});
        }
        break;
      }

      case 'CLARIFY': {
        overlay.setMode('CLARIFY');
        if (decision.candidates) {
          overlay.showCandidates(decision.candidates, (chosen) => {
            overlay.clearCandidates();
            overlay.showClickRipple(chosen.centerX, chosen.centerY);
            executeElementClick(chosen.element, chosen.centerX, chosen.centerY);
          });
        }
        overlay.showVoiceToast('Multiple matches. Say choice or number.', 'COMMAND');
        break;
      }

      case 'CONFIRM': {
        if (!decision.target) return;
        overlay.setMode('CONFIRM');
        pendingConfirmationTarget = decision.target;
        overlay.showConfirmationPrompt(
          decision.target,
          () => {
            if (pendingConfirmationTarget) {
              const target = pendingConfirmationTarget;
              pendingConfirmationTarget = null;
              overlay.showClickRipple(target.centerX, target.centerY);
              executeElementClick(target.element, target.centerX, target.centerY);
            }
          },
          () => {
            pendingConfirmationTarget = null;
            overlay.clearConfirmationPrompt();
          }
        );
        break;
      }

      case 'REJECT': {
        overlay.showVoiceToast(decision.reason, 'ERROR');
        break;
      }

      case 'PAUSE': {
        overlay.showVoiceToast('Tracking is paused', 'ERROR');
        break;
      }
    }
  }

  /**
   * Dictation text handler
   */
  function handleDictation(text: string) {
    overlay.showVoiceToast(text, 'DICTATE');
    AudioLogger.getInstance().logDictation(text);
    const result = DictationController.insertText(text);

    if (result.success && result.element) {
      const el = result.element as HTMLInputElement;
      const prevVal = result.previousValue;

      actionRewind.recordAction({
        type: 'TEXT_INPUT',
        targetElement: el,
        previousValue: prevVal,
        description: `Dictate "${text.substring(0, 20)}"`,
        undo: () => {
          if (el && document.contains(el)) {
            el.value = prevVal || '';
            el.dispatchEvent(new Event('input', { bubbles: true }));
            return true;
          }
          return false;
        },
      });
      MetricsService.recordTaskEvent(true, 80, 'VOICE').catch(() => {});
    } else {
      overlay.showVoiceToast(result.error || 'Please focus an input field first', 'ERROR');
    }
  }

  // Listen for background messages
  if (isExtensionValid() && chrome.runtime.onMessage) {
    try {
      chrome.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
        if (message.type === 'POSE_UPDATE') {
          cursorEngine.processTelemetry(message.telemetry);
          return false; // High-frequency stream, no response needed
        }

        if (message.type === 'TOGGLE_PAUSE') {
          isPaused = message.paused ?? !isPaused;
          cursorEngine.setPaused(isPaused);
          safetyGuard.cancelDwell();
          overlay.clearCandidates();
          overlay.clearConfirmationPrompt();
          sendResponse({ isPaused });
          return false;
        }

        if (message.type === 'CALIBRATION_UPDATED') {
          cursorEngine.setCalibrationProfile(message.profile);
          sendResponse({ updated: true });
          return false;
        }

        if (message.type === 'RECENTER_CURSOR') {
          cursorEngine.recenter();
          safetyGuard.cancelDwell();
          sendResponse({ recentered: true });
          return false;
        }

        if (message.type === 'PING') {
          sendResponse({ type: 'PONG', ready: true });
          return false;
        }

        if (message.type === 'EXECUTE_VOICE_COMMAND' && (message as any).command) {
          handleVoiceCommand((message as any).command);
          sendResponse({ executed: true });
          return false;
        }

        return false;
      });
    } catch {
      // Ignored
    }
  }
}

function executeElementClick(targetElement: HTMLElement, x: number, y: number) {
  try {
    // Prevent clicking our own overlay root
    if (
      targetElement.id === 'handsfree-overlay-root' ||
      targetElement.closest?.('#handsfree-overlay-root')
    ) {
      return;
    }

    // Dispatch full pointer and mouse event cascade safely
    const pointerDown = new PointerEvent('pointerdown', { bubbles: true, cancelable: true, clientX: x, clientY: y });
    const mouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: x, clientY: y });
    const pointerUp = new PointerEvent('pointerup', { bubbles: true, cancelable: true, clientX: x, clientY: y });
    const mouseUp = new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: x, clientY: y });
    const click = new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y });

    targetElement.dispatchEvent(pointerDown);
    targetElement.dispatchEvent(mouseDown);
    targetElement.dispatchEvent(pointerUp);
    targetElement.dispatchEvent(mouseUp);
    targetElement.dispatchEvent(click);

    // Focus if input, textarea, or content-editable
    if (
      targetElement instanceof HTMLInputElement ||
      targetElement instanceof HTMLTextAreaElement ||
      targetElement.isContentEditable ||
      targetElement.tagName === 'SELECT'
    ) {
      targetElement.focus();
    }
  } catch (err) {
    console.warn('[Handsfree] Click execution note:', err);
  }
}
