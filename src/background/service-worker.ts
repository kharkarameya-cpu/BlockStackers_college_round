import { ExtensionMessage } from '../types/messages';
import { LocalAIEngine } from '../core/ai/LocalAIEngine';
import { LocalAIClient } from '../core/ai/LocalAIClient';
import { IntentLearningEngine } from '../core/ai/IntentLearningEngine';
import { ActiveTabManager } from './ActiveTabManager';

console.log('[Handsfree] Background Service Worker started.');

// Initialize active tab lifecycle manager
const tabManager = ActiveTabManager.getInstance();

// Keep track of active tabs
chrome.runtime.onInstalled.addListener(async (details) => {
  console.log('[Handsfree] Extension installed/updated:', details.reason);
  if (details.reason === 'install') {
    // Open onboarding page on first install
    chrome.tabs.create({ url: 'onboarding.html' });
  }
  // Sync active tab state
  tabManager.syncActiveTab();
});

// Route telemetry messages from camera host / offscreen to the active tab
chrome.runtime.onMessage.addListener((message: ExtensionMessage, sender, sendResponse) => {
  if (message.type === 'POSE_UPDATE') {
    tabManager.sendPoseUpdate(message);
    return false; // High-frequency stream, no sendResponse needed
  }

  if (message.type === 'START_TRACKING') {
    ensureOffscreenTracking()
      .then(() => {
        tabManager.syncActiveTab();
        sendResponse({ started: true });
      })
      .catch((err) => sendResponse({ started: false, error: String(err) }));
    return true; // asynchronous
  }

  if (message.type === 'TOGGLE_PAUSE') {
    // Broadcast pause toggle to all tabs
    chrome.tabs.query({}, (tabs) => {
      for (const tab of tabs) {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, message).catch(() => {});
        }
      }
    });
    sendResponse({ toggled: true });
    return false;
  }

  if (message.type === 'GENERATE_ACTION_PLAN') {
    LocalAIClient.getInstance()
      .generateActionPlan(message.instruction, message.context)
      .then((res) => sendResponse(res))
      .catch((err) =>
        sendResponse({
          success: false,
          error: String(err),
          source: 'RULE_FALLBACK',
          latencyMs: 0,
        })
      );
    return true; // async
  }

  if (message.type === 'CANCEL_ACTION_PLAN') {
    LocalAIClient.getInstance().cancelActiveRequest();
    sendResponse({ cancelled: true });
    return false;
  }

  if (message.type === 'PARSE_COMPLEX_INTENT') {
    LocalAIEngine.getInstance()
      .parseComplexSentence(message.text)
      .then((res) => sendResponse({ success: true, result: res }))
      .catch((err) => sendResponse({ success: false, error: String(err) }));
    return true; // async
  }

  if (message.type === 'AI_CONNECTION_TEST') {
    LocalAIClient.getInstance()
      .testConnection()
      .then((res) => sendResponse(res))
      .catch((err) => sendResponse({ connected: false, models: [], message: String(err) }));
    return true; // async
  }

  if (message.type === 'TEACH_ALIAS_COMMAND') {
    IntentLearningEngine.getInstance()
      .teachAlias(message.phrase, message.commandType, message.targetQuery)
      .then((alias) => sendResponse({ success: true, alias }))
      .catch((err) => sendResponse({ success: false, error: String(err) }));
    return true; // async
  }

  if (message.type === 'AUDIO_LOG_ENTRY') {
    // Relay to open extension pages (e.g. diagnostics, popup)
    chrome.runtime.sendMessage(message).catch(() => {});
    return false;
  }

  if (message.type === 'GET_AUDIO_LOGS') {
    chrome.storage.local.get(['handsfree_audio_logs'], (res) => {
      sendResponse({ logs: res?.handsfree_audio_logs || [] });
    });
    return true;
  }

  if (message.type === 'CLEAR_AUDIO_LOGS') {
    chrome.storage.local.remove(['handsfree_audio_logs'], () => {
      chrome.runtime.sendMessage({ type: 'CLEAR_AUDIO_LOGS' }).catch(() => {});
      sendResponse({ cleared: true });
    });
    return true;
  }

  if (message.type === 'VOICE_COMMAND_DETECTED') {
    tabManager.sendToActiveTab({
      type: 'EXECUTE_VOICE_COMMAND',
      command: (message as any).command,
    });
    return false;
  }

  if (message.type === 'START_SPEECH' || message.type === 'STOP_SPEECH') {
    // Forward speech control to offscreen document
    chrome.runtime.sendMessage(message).catch(() => {});
    return false;
  }

  return false;
});

async function ensureOffscreenTracking() {
  if (!chrome.offscreen) return;

  const existingContexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT' as chrome.runtime.ContextType],
  });

  if (existingContexts.length > 0) return;

  try {
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['USER_MEDIA' as chrome.offscreen.Reason],
      justification: 'Webcam head tracking for hands-free cursor navigation',
    });
    console.log('[Handsfree] Offscreen tracking document created.');
  } catch (err) {
    console.warn('[Handsfree] Offscreen document creation note:', err);
  }
}
