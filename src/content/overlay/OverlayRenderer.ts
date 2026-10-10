import { CursorState } from '../../core/cursor/CursorEngine';
import { InteractionMode } from '../../types/tracking';
import { ActionableElement, SemanticMatch } from '../../types/intent';

export interface OverlayOptions {
  onTogglePause?: () => void;
  onRecenter?: () => void;
}

export class OverlayRenderer {
  private hostElement: HTMLElement | null = null;
  private shadowRoot: ShadowRoot | null = null;

  // DOM Elements inside Shadow DOM
  private cursorContainer: HTMLElement | null = null;
  private uncertaintyHalo: HTMLElement | null = null;
  private cursorDot: HTMLElement | null = null;
  private dwellRingProgress: SVGCircleElement | null = null;
  private statusBadge: HTMLElement | null = null;
  private statusText: HTMLElement | null = null;
  private statusDot: HTMLElement | null = null;
  private pauseButton: HTMLButtonElement | null = null;
  private recenterButton: HTMLButtonElement | null = null;
  private confirmationContainer: HTMLElement | null = null;
  private candidateBadgesContainer: HTMLElement | null = null;
  private voiceToast: HTMLElement | null = null;
  private voiceToastTimeout: any = null;
  private aiPlanBanner: HTMLElement | null = null;

  private currentMode: InteractionMode = 'POINT';
  private options: OverlayOptions;

  constructor(options: OverlayOptions = {}) {
    this.options = options;
    this.init();
  }

  private init(): void {
    if (typeof document === 'undefined') return;

    // Remove existing if already present
    const existing = document.getElementById('handsfree-overlay-root');
    if (existing) existing.remove();

    this.hostElement = document.createElement('div');
    this.hostElement.id = 'handsfree-overlay-root';
    this.hostElement.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 0;
      height: 0;
      z-index: 2147483647;
      pointer-events: none;
    `;

    this.shadowRoot = this.hostElement.attachShadow({ mode: 'closed' });

    // Stylesheet inside shadow root to completely insulate from page styles
    const style = document.createElement('style');
    style.textContent = `
      * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }

      .cursor-wrapper {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        pointer-events: none;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: opacity 0.2s ease;
      }

      .uncertainty-halo {
        position: absolute;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(6, 182, 212, 0.25) 0%, rgba(59, 130, 246, 0.08) 60%, rgba(59, 130, 246, 0) 100%);
        border: 1px solid rgba(6, 182, 212, 0.35);
        pointer-events: none;
        transition: width 0.15s ease-out, height 0.15s ease-out;
        box-shadow: 0 0 15px rgba(6, 182, 212, 0.2);
      }

      .cursor-ring {
        position: absolute;
        width: 32px;
        height: 32px;
        pointer-events: none;
      }

      .cursor-dot {
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: #06b6d4;
        border: 2px solid #ffffff;
        box-shadow: 0 0 8px rgba(6, 182, 212, 0.8), 0 2px 4px rgba(0,0,0,0.4);
        z-index: 2;
        transition: transform 0.1s ease;
      }

      .cursor-dot.lost {
        background: #ef4444;
        box-shadow: 0 0 8px rgba(239, 68, 68, 0.8);
      }

      .cursor-dot.paused {
        background: #f59e0b;
        box-shadow: 0 0 8px rgba(245, 158, 11, 0.8);
      }

      .dwell-svg {
        position: absolute;
        width: 44px;
        height: 44px;
        transform: rotate(-90deg);
      }

      .dwell-bg {
        fill: none;
        stroke: rgba(255, 255, 255, 0.2);
        stroke-width: 3;
      }

      .dwell-progress {
        fill: none;
        stroke: #38bdf8;
        stroke-width: 3.5;
        stroke-linecap: round;
        stroke-dasharray: 100;
        stroke-dashoffset: 100;
        transition: stroke-dashoffset 0.05s linear;
      }

      .click-ripple {
        position: fixed;
        border-radius: 50%;
        background: radial-gradient(circle, rgba(56, 189, 248, 0.6) 0%, rgba(59, 130, 246, 0) 70%);
        border: 2px solid #38bdf8;
        transform: translate(-50%, -50%);
        pointer-events: none;
        animation: rippleAnim 0.45s cubic-bezier(0.1, 0.8, 0.3, 1) forwards;
      }

      @keyframes rippleAnim {
        0% { width: 10px; height: 10px; opacity: 1; }
        100% { width: 68px; height: 68px; opacity: 0; }
      }

      /* In-Page Status HUD */
      .hud-container {
        position: fixed;
        bottom: 24px;
        right: 24px;
        background: rgba(15, 23, 42, 0.88);
        backdrop-filter: blur(12px);
        -webkit-backdrop-filter: blur(12px);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 12px;
        padding: 8px 14px;
        display: flex;
        align-items: center;
        gap: 12px;
        pointer-events: auto;
        color: #f8fafc;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
        z-index: 2147483647;
        user-select: none;
        font-size: 13px;
      }

      .status-pill {
        display: flex;
        align-items: center;
        gap: 6px;
        font-weight: 500;
      }

      .status-dot {
        width: 8px;
        height: 8px;
        border-radius: 50%;
        background: #10b981;
        box-shadow: 0 0 6px #10b981;
      }

      .hud-btn {
        background: rgba(255, 255, 255, 0.08);
        border: 1px solid rgba(255, 255, 255, 0.14);
        color: #e2e8f0;
        border-radius: 6px;
        padding: 4px 10px;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s ease;
      }

      .hud-btn:hover {
        background: rgba(255, 255, 255, 0.18);
        color: #ffffff;
      }

      /* Candidate Clarification Badges */
      .candidate-badge {
        position: fixed;
        transform: translate(-50%, -50%);
        background: rgba(15, 23, 42, 0.95);
        border: 2px solid #06b6d4;
        color: #ffffff;
        border-radius: 9999px;
        padding: 4px 10px;
        font-size: 13px;
        font-weight: 700;
        box-shadow: 0 0 15px rgba(6, 182, 212, 0.6), 0 4px 12px rgba(0, 0, 0, 0.5);
        pointer-events: auto;
        cursor: pointer;
        z-index: 2147483646;
        display: flex;
        align-items: center;
        gap: 6px;
        animation: badgePulse 1.5s infinite alternate ease-in-out;
      }

      .candidate-badge-num {
        background: #06b6d4;
        color: #0f172a;
        border-radius: 50%;
        width: 18px;
        height: 18px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 11px;
        font-weight: 800;
      }

      @keyframes badgePulse {
        0% { transform: translate(-50%, -50%) scale(1); box-shadow: 0 0 10px rgba(6, 182, 212, 0.4); }
        100% { transform: translate(-50%, -50%) scale(1.08); box-shadow: 0 0 20px rgba(6, 182, 212, 0.8); }
      }

      /* High-Risk Confirmation Banner */
      .confirmation-banner {
        position: fixed;
        top: 24px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(15, 23, 42, 0.96);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border: 2px solid #f59e0b;
        box-shadow: 0 0 25px rgba(245, 158, 11, 0.4), 0 12px 36px rgba(0, 0, 0, 0.6);
        border-radius: 16px;
        padding: 14px 20px;
        color: #f8fafc;
        z-index: 2147483647;
        pointer-events: auto;
        display: flex;
        align-items: center;
        gap: 16px;
        font-size: 13px;
        max-width: 650px;
        animation: slideDown 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      }

      @keyframes slideDown {
        0% { opacity: 0; transform: translate(-50%, -20px); }
        100% { opacity: 1; transform: translate(-50%, 0); }
      }

      .confirm-btn-primary {
        background: #f59e0b;
        color: #0f172a;
        font-weight: 700;
        border: none;
        border-radius: 8px;
        padding: 6px 14px;
        cursor: pointer;
        transition: background 0.15s ease;
      }
      .confirm-btn-primary:hover { background: #fbbf24; }

      .confirm-btn-secondary {
        background: rgba(255, 255, 255, 0.1);
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: #e2e8f0;
        font-weight: 600;
        border-radius: 8px;
        padding: 6px 14px;
        cursor: pointer;
      }
      .confirm-btn-secondary:hover { background: rgba(255, 255, 255, 0.2); }

      /* Voice Toast */
      .voice-toast {
        position: fixed;
        bottom: 74px;
        right: 24px;
        background: rgba(15, 23, 42, 0.92);
        backdrop-filter: blur(12px);
        border: 1px solid rgba(6, 182, 212, 0.4);
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
        border-radius: 10px;
        padding: 8px 14px;
        color: #e2e8f0;
        font-size: 12px;
        font-weight: 500;
        display: flex;
        align-items: center;
        gap: 8px;
        z-index: 2147483647;
        pointer-events: none;
        transition: opacity 0.2s ease;
      }

      /* AI Action Plan Banner */
      .ai-plan-banner {
        position: fixed;
        bottom: 24px;
        right: 24px;
        background: rgba(15, 23, 42, 0.96);
        backdrop-filter: blur(16px);
        -webkit-backdrop-filter: blur(16px);
        border: 1px solid rgba(6, 182, 212, 0.5);
        border-radius: 12px;
        padding: 12px 16px;
        color: #f8fafc;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6), 0 0 20px rgba(6, 182, 212, 0.2);
        z-index: 2147483646;
        pointer-events: auto;
        display: flex;
        flex-direction: column;
        gap: 6px;
        min-width: 280px;
        max-width: 380px;
        font-size: 13px;
      }
      .ai-plan-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-weight: 700;
        font-size: 11px;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        color: #06b6d4;
      }
      .ai-plan-cancel-btn {
        background: rgba(239, 68, 68, 0.2);
        border: 1px solid rgba(239, 68, 68, 0.4);
        color: #fca5a5;
        border-radius: 6px;
        padding: 2px 8px;
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
      }
      .ai-plan-cancel-btn:hover {
        background: rgba(239, 68, 68, 0.4);
      }
      .ai-plan-goal {
        font-size: 12px;
        color: #e2e8f0;
        font-weight: 600;
      }
      .ai-plan-step-text {
        font-size: 11px;
        color: #94a3b8;
      }
    `;

    this.shadowRoot.appendChild(style);

    // Build cursor container
    this.cursorContainer = document.createElement('div');
    this.cursorContainer.className = 'cursor-wrapper';
    const initX = typeof window !== 'undefined' ? window.innerWidth / 2 : 500;
    const initY = typeof window !== 'undefined' ? window.innerHeight / 2 : 400;
    this.cursorContainer.style.left = `${initX}px`;
    this.cursorContainer.style.top = `${initY}px`;

    // Uncertainty halo
    this.uncertaintyHalo = document.createElement('div');
    this.uncertaintyHalo.className = 'uncertainty-halo';
    this.uncertaintyHalo.style.width = '40px';
    this.uncertaintyHalo.style.height = '40px';
    this.cursorContainer.appendChild(this.uncertaintyHalo);

    // SVG Dwell indicator
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'dwell-svg');
    svg.setAttribute('viewBox', '0 0 44 44');

    const bgCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    bgCircle.setAttribute('class', 'dwell-bg');
    bgCircle.setAttribute('cx', '22');
    bgCircle.setAttribute('cy', '22');
    bgCircle.setAttribute('r', '16');
    svg.appendChild(bgCircle);

    this.dwellRingProgress = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    this.dwellRingProgress.setAttribute('class', 'dwell-progress');
    this.dwellRingProgress.setAttribute('cx', '22');
    this.dwellRingProgress.setAttribute('cy', '22');
    this.dwellRingProgress.setAttribute('r', '16');
    svg.appendChild(this.dwellRingProgress);

    this.cursorContainer.appendChild(svg);

    // Center dot
    this.cursorDot = document.createElement('div');
    this.cursorDot.className = 'cursor-dot';
    this.cursorContainer.appendChild(this.cursorDot);

    this.shadowRoot.appendChild(this.cursorContainer);

    // Build HUD
    this.statusBadge = document.createElement('div');
    this.statusBadge.className = 'hud-container';

    this.statusDot = document.createElement('div');
    this.statusDot.className = 'status-dot';

    this.statusText = document.createElement('span');
    this.statusText.className = 'status-pill';
    this.statusText.appendChild(this.statusDot);
    const textNode = document.createElement('span');
    textNode.textContent = 'Tracking Active';
    this.statusText.appendChild(textNode);
    this.statusBadge.appendChild(this.statusText);

    this.recenterButton = document.createElement('button');
    this.recenterButton.className = 'hud-btn';
    this.recenterButton.textContent = 'Recenter';
    this.recenterButton.onclick = () => {
      if (this.options.onRecenter) this.options.onRecenter();
    };
    this.statusBadge.appendChild(this.recenterButton);

    this.pauseButton = document.createElement('button');
    this.pauseButton.className = 'hud-btn';
    this.pauseButton.textContent = 'Pause (Esc)';
    this.pauseButton.onclick = () => {
      if (this.options.onTogglePause) this.options.onTogglePause();
    };
    this.statusBadge.appendChild(this.pauseButton);

    this.shadowRoot.appendChild(this.statusBadge);

    // Keyboard shortcut (Escape to toggle pause) - only when not actively typing in an input
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const active = document.activeElement;
        if (
          active instanceof HTMLInputElement ||
          active instanceof HTMLTextAreaElement ||
          (active instanceof HTMLElement && active.isContentEditable)
        ) {
          return;
        }
        if (this.options.onTogglePause) this.options.onTogglePause();
      }
    });

    const targetParent = document.body || document.documentElement;
    if (targetParent) {
      targetParent.appendChild(this.hostElement);
    }
  }

  public updateCursor(state: CursorState): void {
    if (!this.cursorContainer || !this.cursorDot || !this.uncertaintyHalo) return;

    // Ensure overlay remains attached to DOM if Google/SPA replaced the body
    if (this.hostElement && !document.contains(this.hostElement)) {
      const parent = document.body || document.documentElement;
      if (parent) parent.appendChild(this.hostElement);
    }

    // Update position safely (fallback to center of viewport if 0 or invalid)
    const fallbackX = typeof window !== 'undefined' ? window.innerWidth / 2 : 500;
    const fallbackY = typeof window !== 'undefined' ? window.innerHeight / 2 : 400;
    const posX = Number.isFinite(state.x) && state.x > 0 ? state.x : fallbackX;
    const posY = Number.isFinite(state.y) && state.y > 0 ? state.y : fallbackY;
    this.cursorContainer.style.left = `${posX}px`;
    this.cursorContainer.style.top = `${posY}px`;

    // Uncertainty Halo sizing
    const haloSize = Math.max(24, state.uncertaintyRadius * 2);
    this.uncertaintyHalo.style.width = `${haloSize}px`;
    this.uncertaintyHalo.style.height = `${haloSize}px`;

    // Dwell Progress Ring (Circumference = 2 * PI * 16 ~= 100.53)
    if (this.dwellRingProgress) {
      const circ = 100.53;
      const offset = circ - state.dwellProgress * circ;
      this.dwellRingProgress.style.strokeDashoffset = `${offset}`;
    }

    // Status display & dot styling
    if (state.isPaused) {
      this.cursorDot.className = 'cursor-dot paused';
      this.updateHudState('Paused', '#f59e0b', 'Resume');
    } else if (state.trackingState === 'TEMPORARILY_LOST' || state.trackingState === 'REACQUIRING') {
      this.cursorDot.className = 'cursor-dot holding';
      this.updateHudState('Holding...', '#f59e0b', 'Pause');
    } else if (state.trackingLost || state.trackingState === 'NO_FACE') {
      this.cursorDot.className = 'cursor-dot lost';
      this.updateHudState('Target Not Visible', '#ef4444', 'Pause');
    } else {
      this.cursorDot.className = 'cursor-dot';
      const label = state.isPinching
        ? 'Pinching (Click)'
        : state.activeGesture && state.activeGesture !== 'UNKNOWN' && state.activeGesture !== 'POINTING'
        ? `Hand: ${state.activeGesture}`
        : 'Tracking Active';
      this.updateHudState(label, '#10b981', 'Pause');
    }
  }

  private updateHudState(label: string, dotColor: string, btnLabel: string): void {
    if (this.statusDot) {
      this.statusDot.style.background = dotColor;
      this.statusDot.style.boxShadow = `0 0 6px ${dotColor}`;
    }
    if (this.statusText && this.statusText.lastChild) {
      this.statusText.lastChild.textContent = label;
    }
    if (this.pauseButton) {
      this.pauseButton.textContent = `${btnLabel} (Esc)`;
    }
  }

  public showClickRipple(x: number, y: number): void {
    if (!this.shadowRoot) return;

    const ripple = document.createElement('div');
    ripple.className = 'click-ripple';
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;

    this.shadowRoot.appendChild(ripple);
    setTimeout(() => {
      ripple.remove();
    }, 500);
  }

  public setMode(mode: InteractionMode): void {
    this.currentMode = mode;
  }

  public getMode(): InteractionMode {
    return this.currentMode;
  }

  /**
   * Display numbered clarification badges over candidate elements
   */
  public showCandidates(
    candidates: SemanticMatch[],
    onSelect?: (candidate: ActionableElement) => void
  ): void {
    this.clearCandidates();
    if (!this.shadowRoot || candidates.length === 0) return;

    this.candidateBadgesContainer = document.createElement('div');
    this.candidateBadgesContainer.style.cssText = 'position: fixed; top: 0; left: 0; width: 0; height: 0; pointer-events: none; z-index: 2147483646;';

    candidates.forEach((match, index) => {
      const el = match.candidate;
      const badge = document.createElement('div');
      badge.className = 'candidate-badge';
      badge.style.left = `${el.centerX}px`;
      badge.style.top = `${el.centerY}px`;

      const num = document.createElement('span');
      num.className = 'candidate-badge-num';
      num.textContent = `${index + 1}`;
      badge.appendChild(num);

      const label = document.createElement('span');
      label.textContent = el.accessibleName || el.visibleText || `Choice ${index + 1}`;
      badge.appendChild(label);

      badge.onclick = (e) => {
        e.stopPropagation();
        if (onSelect) onSelect(el);
      };

      this.candidateBadgesContainer?.appendChild(badge);
    });

    this.shadowRoot.appendChild(this.candidateBadgesContainer);
  }

  public clearCandidates(): void {
    if (this.candidateBadgesContainer) {
      this.candidateBadgesContainer.remove();
      this.candidateBadgesContainer = null;
    }
  }

  /**
   * Display explicit confirmation prompt for high-impact actions
   */
  public showConfirmationPrompt(
    target: ActionableElement,
    onConfirm: () => void,
    onCancel: () => void
  ): void {
    this.clearConfirmationPrompt();
    if (!this.shadowRoot) return;

    this.confirmationContainer = document.createElement('div');
    this.confirmationContainer.className = 'confirmation-banner';

    const info = document.createElement('div');
    info.style.flex = '1';
    info.innerHTML = `
      <div style="font-weight: 700; color: #f59e0b; display: flex; align-items: center; gap: 6px;">
        <span>⚠️</span> Confirm Consequential Action
      </div>
      <div style="font-size: 12px; color: #cbd5e1; margin-top: 4px;">
        Target: <strong style="color: #fff;">"${target.accessibleName || target.visibleText}"</strong>
      </div>
      <div style="font-size: 11px; color: #94a3b8; margin-top: 2px;">
        Say <strong style="color: #f59e0b;">"Confirm"</strong> or <strong style="color: #94a3b8;">"Cancel"</strong>, or click below.
      </div>
    `;
    this.confirmationContainer.appendChild(info);

    const btnGroup = document.createElement('div');
    btnGroup.style.cssText = 'display: flex; gap: 8px; align-items: center;';

    const confirmBtn = document.createElement('button');
    confirmBtn.className = 'confirm-btn-primary';
    confirmBtn.textContent = 'Confirm Action';
    confirmBtn.onclick = () => {
      this.clearConfirmationPrompt();
      onConfirm();
    };
    btnGroup.appendChild(confirmBtn);

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'confirm-btn-secondary';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.onclick = () => {
      this.clearConfirmationPrompt();
      onCancel();
    };
    btnGroup.appendChild(cancelBtn);

    this.confirmationContainer.appendChild(btnGroup);
    this.shadowRoot.appendChild(this.confirmationContainer);
  }

  public clearConfirmationPrompt(): void {
    if (this.confirmationContainer) {
      this.confirmationContainer.remove();
      this.confirmationContainer = null;
    }
  }

  /**
   * Show transient voice transcription / command toast feedback
   */
  public showVoiceToast(
    text: string,
    type: 'COMMAND' | 'DICTATE' | 'ERROR' | 'INFO' = 'COMMAND'
  ): void {
    if (!this.shadowRoot) return;

    if (this.voiceToast) {
      this.voiceToast.remove();
      clearTimeout(this.voiceToastTimeout);
    }

    this.voiceToast = document.createElement('div');
    this.voiceToast.className = 'voice-toast';

    const icon = type === 'DICTATE' ? '✍️' : type === 'ERROR' ? '⚠️' : type === 'INFO' ? 'ℹ️' : '🎙️';
    this.voiceToast.innerHTML = `<span>${icon}</span> <span>${text}</span>`;

    if (type === 'ERROR') {
      this.voiceToast.style.borderColor = '#ef4444';
      this.voiceToast.style.color = '#fca5a5';
    } else if (type === 'DICTATE') {
      this.voiceToast.style.borderColor = '#10b981';
      this.voiceToast.style.color = '#6ee7b7';
    } else if (type === 'INFO') {
      this.voiceToast.style.borderColor = '#06b6d4';
      this.voiceToast.style.color = '#67e8f9';
    }

    this.shadowRoot.appendChild(this.voiceToast);

    this.voiceToastTimeout = setTimeout(() => {
      if (this.voiceToast) {
        this.voiceToast.style.opacity = '0';
        setTimeout(() => {
          this.voiceToast?.remove();
          this.voiceToast = null;
        }, 200);
      }
    }, 2500);
  }

  /**
   * Show floating AI Action Plan HUD with current goal, step count, and cancel control
   */
  public showActionPlan(
    reason: string,
    totalSteps: number,
    onCancel?: () => void
  ): void {
    this.clearActionPlan();
    if (!this.shadowRoot) return;

    this.aiPlanBanner = document.createElement('div');
    this.aiPlanBanner.className = 'ai-plan-banner';

    const header = document.createElement('div');
    header.className = 'ai-plan-header';
    header.innerHTML = `<span>🤖 Qwen2.5 Local AI</span>`;

    if (onCancel) {
      const cancelBtn = document.createElement('button');
      cancelBtn.className = 'ai-plan-cancel-btn';
      cancelBtn.textContent = 'Cancel Plan';
      cancelBtn.onclick = (e) => {
        e.stopPropagation();
        this.clearActionPlan();
        onCancel();
      };
      header.appendChild(cancelBtn);
    }
    this.aiPlanBanner.appendChild(header);

    const goal = document.createElement('div');
    goal.className = 'ai-plan-goal';
    goal.textContent = reason;
    this.aiPlanBanner.appendChild(goal);

    const stepEl = document.createElement('div');
    stepEl.className = 'ai-plan-step-text';
    stepEl.textContent = `Executing ${totalSteps} step${totalSteps > 1 ? 's' : ''}...`;
    this.aiPlanBanner.appendChild(stepEl);

    this.shadowRoot.appendChild(this.aiPlanBanner);
  }

  public updateActionPlanStep(currentStep: number, totalSteps: number, description: string): void {
    if (!this.aiPlanBanner) return;
    const stepEl = this.aiPlanBanner.querySelector('.ai-plan-step-text');
    if (stepEl) {
      stepEl.textContent = `Step ${currentStep} of ${totalSteps}: ${description}`;
    }
  }

  public clearActionPlan(): void {
    if (this.aiPlanBanner) {
      this.aiPlanBanner.remove();
      this.aiPlanBanner = null;
    }
  }

  public destroy(): void {
    this.clearCandidates();
    this.clearConfirmationPrompt();
    this.clearActionPlan();
    if (this.voiceToast) this.voiceToast.remove();
    if (this.hostElement && this.hostElement.parentNode) {
      this.hostElement.parentNode.removeChild(this.hostElement);
    }
    this.hostElement = null;
    this.shadowRoot = null;
  }
}
