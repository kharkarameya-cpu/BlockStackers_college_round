import { PoseUpdateMessage } from '../types/messages';

/**
 * Central Active-Tab Lifecycle Manager for Handsfree MV3
 * Tracks the eligible active tab, performs ready handshakes,
 * injects content scripts into pre-existing tabs when permitted,
 * and routes high-frequency tracking telemetry without flooding chrome.tabs.query.
 */
export class ActiveTabManager {
  private static instance: ActiveTabManager | null = null;

  private activeTabId: number | null = null;
  private activeTabUrl: string = '';
  private isEligible: boolean = false;
  private isReady: boolean = false;
  private lastError: string | null = null;
  private isHandshaking: boolean = false;

  private constructor() {
    this.setupListeners();
    this.syncActiveTab();
  }

  public static getInstance(): ActiveTabManager {
    if (!ActiveTabManager.instance) {
      ActiveTabManager.instance = new ActiveTabManager();
    }
    return ActiveTabManager.instance;
  }

  public static isEligibleUrl(url?: string): boolean {
    if (!url) return false;
    const lower = url.toLowerCase();
    if (
      lower.startsWith('chrome://') ||
      lower.startsWith('chrome-extension://') ||
      lower.startsWith('edge://') ||
      lower.startsWith('about:') ||
      lower.startsWith('view-source:') ||
      lower.startsWith('devtools:') ||
      lower.includes('chrome.google.com/webstore') ||
      lower.includes('chromewebstore.google.com')
    ) {
      return false;
    }
    return lower.startsWith('http://') || lower.startsWith('https://') || lower.startsWith('file://');
  }

  private setupListeners(): void {
    if (typeof chrome === 'undefined' || !chrome.tabs) return;

    // 1. Tab activated (user switched tabs)
    chrome.tabs.onActivated.addListener((activeInfo) => {
      this.handleTabActivated(activeInfo.tabId);
    });

    // 2. Tab updated (navigation, reload, url change)
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (tabId === this.activeTabId) {
        if (changeInfo.status === 'loading') {
          // Tab started navigating
          this.isReady = false;
        }
        if (changeInfo.url) {
          this.activeTabUrl = changeInfo.url;
          this.isEligible = ActiveTabManager.isEligibleUrl(changeInfo.url);
        }
        if (changeInfo.status === 'complete' && tab.url) {
          this.activeTabUrl = tab.url;
          this.isEligible = ActiveTabManager.isEligibleUrl(tab.url);
          if (this.isEligible) {
            this.performHandshake(tabId);
          }
        }
      }
    });

    // 3. Tab closed
    chrome.tabs.onRemoved.addListener((tabId) => {
      if (tabId === this.activeTabId) {
        this.activeTabId = null;
        this.activeTabUrl = '';
        this.isEligible = false;
        this.isReady = false;
        this.syncActiveTab();
      }
    });

    // 4. Window focus changed
    if (chrome.windows?.onFocusChanged) {
      chrome.windows.onFocusChanged.addListener((windowId) => {
        if (windowId !== chrome.windows.WINDOW_ID_NONE) {
          this.syncActiveTab();
        }
      });
    }
  }

  public syncActiveTab(): void {
    if (typeof chrome === 'undefined' || !chrome.tabs?.query) return;

    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      const tab = tabs[0];
      if (tab && tab.id) {
        this.handleTabActivated(tab.id, tab.url);
      }
    });
  }

  private handleTabActivated(tabId: number, url?: string): void {
    this.activeTabId = tabId;
    this.isReady = false;

    if (url) {
      this.activeTabUrl = url;
      this.isEligible = ActiveTabManager.isEligibleUrl(url);
      if (this.isEligible) {
        this.performHandshake(tabId);
      }
    } else {
      chrome.tabs.get(tabId, (tab) => {
        if (chrome.runtime.lastError || !tab) {
          this.isEligible = false;
          return;
        }
        this.activeTabUrl = tab.url || '';
        this.isEligible = ActiveTabManager.isEligibleUrl(tab.url);
        if (this.isEligible) {
          this.performHandshake(tabId);
        }
      });
    }
  }

  /**
   * Ping content script to verify readiness.
   * If not responding and tab is eligible, programmatically inject content.js (handles tabs loaded before extension).
   */
  public async performHandshake(tabId: number): Promise<boolean> {
    if (this.isHandshaking) return false;
    this.isHandshaking = true;

    try {
      const isAlive = await this.pingTab(tabId);
      if (isAlive) {
        this.isReady = true;
        this.lastError = null;
        return true;
      }

      // Tab not responding - attempt injection if eligible
      if (this.isEligible && chrome.scripting?.executeScript) {
        try {
          await chrome.scripting.executeScript({
            target: { tabId },
            files: ['content.js'],
          });
          // Wait briefly for content script initialization
          await new Promise((r) => setTimeout(r, 120));
          const retriedAlive = await this.pingTab(tabId);
          if (retriedAlive) {
            this.isReady = true;
            this.lastError = null;
            return true;
          }
        } catch (injectErr: any) {
          this.lastError = `Script injection note: ${injectErr?.message || injectErr}`;
        }
      }

      this.isReady = false;
      return false;
    } finally {
      this.isHandshaking = false;
    }
  }

  private pingTab(tabId: number): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        chrome.tabs.sendMessage(tabId, { type: 'PING' }, (response) => {
          if (chrome.runtime.lastError) {
            resolve(false);
          } else {
            resolve(response?.ready === true || response?.type === 'PONG');
          }
        });
      } catch {
        resolve(false);
      }
    });
  }

  /**
   * Fast synchronous telemetry dispatch to active eligible tab.
   * Zero IPC query overhead.
   */
  public sendPoseUpdate(message: PoseUpdateMessage): void {
    if (!this.activeTabId || !this.isEligible) return;

    // Send without blocking
    try {
      chrome.tabs.sendMessage(this.activeTabId, message, () => {
        if (chrome.runtime.lastError) {
          // If receiving end stopped existing, mark not ready and trigger handshake
          if (this.isReady) {
            this.isReady = false;
            this.performHandshake(this.activeTabId!);
          }
        } else {
          this.isReady = true;
        }
      });
    } catch {
      this.isReady = false;
    }
  }

  /**
   * Send a general message (e.g. voice command) to the active eligible tab.
   */
  public sendToActiveTab(message: any): void {
    if (!this.activeTabId || !this.isEligible) return;
    try {
      chrome.tabs.sendMessage(this.activeTabId, message, () => {
        if (chrome.runtime.lastError) {
          // Tab may not be ready or page unloaded
        }
      });
    } catch {
      // Ignored
    }
  }

  public getStatus() {
    return {
      activeTabId: this.activeTabId,
      activeTabUrl: this.activeTabUrl,
      isEligible: this.isEligible,
      isReady: this.isReady,
      lastError: this.lastError,
    };
  }
}
