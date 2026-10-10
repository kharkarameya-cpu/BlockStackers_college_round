import {
  CalibrationProfile,
  DEFAULT_CALIBRATION_PROFILE,
  DEFAULT_ONE_EURO_PARAMS,
  OneEuroParams,
} from '../../types/tracking';

import {
  CommandAlias,
  DEFAULT_LOCAL_AI_CONFIG,
  LearnedIntentExemplar,
  LocalAIConfig,
} from '../../types/ai';

const STORAGE_KEYS = {
  CALIBRATION: 'handsfree_calibration_profile',
  FILTER_PARAMS: 'handsfree_filter_params',
  IS_PAUSED: 'handsfree_is_paused',
  LOCAL_AI_CONFIG: 'handsfree_local_ai_config',
  LEARNED_EXEMPLARS: 'handsfree_learned_exemplars',
  COMMAND_ALIASES: 'handsfree_command_aliases',
};

function isExtensionValid(): boolean {
  return typeof chrome !== 'undefined' && Boolean(chrome.runtime?.id) && Boolean(chrome.storage?.local);
}

export class SettingsService {
  /**
   * Load stored calibration profile or return default
   */
  public static async getCalibrationProfile(): Promise<CalibrationProfile> {
    try {
      if (isExtensionValid()) {
        const result = await chrome.storage.local.get(STORAGE_KEYS.CALIBRATION);
        if (result && result[STORAGE_KEYS.CALIBRATION]) {
          return { ...DEFAULT_CALIBRATION_PROFILE, ...result[STORAGE_KEYS.CALIBRATION] };
        }
      } else if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(STORAGE_KEYS.CALIBRATION);
        if (raw) return { ...DEFAULT_CALIBRATION_PROFILE, ...JSON.parse(raw) };
      }
    } catch (e) {
      console.warn('[Handsfree] Notice loading calibration profile:', e);
    }
    return { ...DEFAULT_CALIBRATION_PROFILE };
  }

  /**
   * Save calibration profile
   */
  public static async saveCalibrationProfile(profile: CalibrationProfile): Promise<void> {
    try {
      const updated = { ...profile, updatedAt: Date.now() };
      if (isExtensionValid()) {
        await chrome.storage.local.set({ [STORAGE_KEYS.CALIBRATION]: updated });
      } else if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEYS.CALIBRATION, JSON.stringify(updated));
      }
    } catch (e) {
      console.warn('[Handsfree] Notice saving calibration profile:', e);
    }
  }

  /**
   * Load One Euro Filter params
   */
  public static async getFilterParams(): Promise<OneEuroParams> {
    try {
      if (isExtensionValid()) {
        const result = await chrome.storage.local.get(STORAGE_KEYS.FILTER_PARAMS);
        if (result && result[STORAGE_KEYS.FILTER_PARAMS]) {
          return { ...DEFAULT_ONE_EURO_PARAMS, ...result[STORAGE_KEYS.FILTER_PARAMS] };
        }
      } else if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(STORAGE_KEYS.FILTER_PARAMS);
        if (raw) return { ...DEFAULT_ONE_EURO_PARAMS, ...JSON.parse(raw) };
      }
    } catch (e) {
      console.warn('[Handsfree] Notice loading filter params:', e);
    }
    return { ...DEFAULT_ONE_EURO_PARAMS };
  }

  /**
   * Get paused state
   */
  public static async getIsPaused(): Promise<boolean> {
    try {
      if (isExtensionValid()) {
        const result = await chrome.storage.local.get(STORAGE_KEYS.IS_PAUSED);
        return Boolean(result && result[STORAGE_KEYS.IS_PAUSED]);
      } else if (typeof localStorage !== 'undefined') {
        return localStorage.getItem(STORAGE_KEYS.IS_PAUSED) === 'true';
      }
    } catch (e) {
      console.warn('[Handsfree] Notice loading pause state:', e);
    }
    return false;
  }

  /**
   * Set paused state
   */
  public static async setIsPaused(paused: boolean): Promise<void> {
    try {
      if (isExtensionValid()) {
        await chrome.storage.local.set({ [STORAGE_KEYS.IS_PAUSED]: paused });
      } else if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEYS.IS_PAUSED, String(paused));
      }
    } catch (e) {
      console.warn('[Handsfree] Notice setting pause state:', e);
    }
  }

  /**
   * Load Local AI (Qwen) configuration
   */
  public static async getLocalAIConfig(): Promise<LocalAIConfig> {
    try {
      if (isExtensionValid()) {
        const result = await chrome.storage.local.get(STORAGE_KEYS.LOCAL_AI_CONFIG);
        if (result && result[STORAGE_KEYS.LOCAL_AI_CONFIG]) {
          return { ...DEFAULT_LOCAL_AI_CONFIG, ...result[STORAGE_KEYS.LOCAL_AI_CONFIG] };
        }
      } else if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(STORAGE_KEYS.LOCAL_AI_CONFIG);
        if (raw) return { ...DEFAULT_LOCAL_AI_CONFIG, ...JSON.parse(raw) };
      }
    } catch (e) {
      console.warn('[Handsfree] Notice loading Local AI config:', e);
    }
    return { ...DEFAULT_LOCAL_AI_CONFIG };
  }

  /**
   * Save Local AI configuration
   */
  public static async saveLocalAIConfig(config: LocalAIConfig): Promise<void> {
    try {
      if (isExtensionValid()) {
        await chrome.storage.local.set({ [STORAGE_KEYS.LOCAL_AI_CONFIG]: config });
      } else if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEYS.LOCAL_AI_CONFIG, JSON.stringify(config));
      }
    } catch (e) {
      console.warn('[Handsfree] Notice saving Local AI config:', e);
    }
  }

  /**
   * Load learned intent exemplars
   */
  public static async getLearnedExemplars(): Promise<LearnedIntentExemplar[]> {
    try {
      if (isExtensionValid()) {
        const result = await chrome.storage.local.get(STORAGE_KEYS.LEARNED_EXEMPLARS);
        if (result && Array.isArray(result[STORAGE_KEYS.LEARNED_EXEMPLARS])) {
          return result[STORAGE_KEYS.LEARNED_EXEMPLARS];
        }
      } else if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(STORAGE_KEYS.LEARNED_EXEMPLARS);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) return parsed;
        }
      }
    } catch (e) {
      console.warn('[Handsfree] Notice loading learned exemplars:', e);
    }
    return [];
  }

  /**
   * Save learned intent exemplars
   */
  public static async saveLearnedExemplars(exemplars: LearnedIntentExemplar[]): Promise<void> {
    try {
      if (isExtensionValid()) {
        await chrome.storage.local.set({ [STORAGE_KEYS.LEARNED_EXEMPLARS]: exemplars });
      } else if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEYS.LEARNED_EXEMPLARS, JSON.stringify(exemplars));
      }
    } catch (e) {
      console.warn('[Handsfree] Notice saving learned exemplars:', e);
    }
  }

  /**
   * Load personal command aliases
   */
  public static async getCommandAliases(): Promise<CommandAlias[]> {
    try {
      if (isExtensionValid()) {
        const result = await chrome.storage.local.get(STORAGE_KEYS.COMMAND_ALIASES);
        if (result && Array.isArray(result[STORAGE_KEYS.COMMAND_ALIASES])) {
          return result[STORAGE_KEYS.COMMAND_ALIASES];
        }
      } else if (typeof localStorage !== 'undefined') {
        const raw = localStorage.getItem(STORAGE_KEYS.COMMAND_ALIASES);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) return parsed;
        }
      }
    } catch (e) {
      console.warn('[Handsfree] Notice loading command aliases:', e);
    }
    return [];
  }

  /**
   * Save personal command aliases
   */
  public static async saveCommandAliases(aliases: CommandAlias[]): Promise<void> {
    try {
      if (isExtensionValid()) {
        await chrome.storage.local.set({ [STORAGE_KEYS.COMMAND_ALIASES]: aliases });
      } else if (typeof localStorage !== 'undefined') {
        localStorage.setItem(STORAGE_KEYS.COMMAND_ALIASES, JSON.stringify(aliases));
      }
    } catch (e) {
      console.warn('[Handsfree] Notice saving command aliases:', e);
    }
  }
}
