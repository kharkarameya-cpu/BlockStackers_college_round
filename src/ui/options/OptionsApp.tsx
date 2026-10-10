import React, { useState, useEffect } from 'react';
import { SettingsService } from '../../core/storage/SettingsService';
import {
  CalibrationProfile,
  DEFAULT_CALIBRATION_PROFILE,
  DEFAULT_ONE_EURO_PARAMS,
  OneEuroParams,
} from '../../types/tracking';
import { MetricsService, DEFAULT_METRICS } from '../../core/metrics/MetricsService';
import { BenchmarkMetrics, VoiceCommandType } from '../../types/intent';
import {
  CommandAlias,
  DEFAULT_LOCAL_AI_CONFIG,
  LearnedIntentExemplar,
  LocalAIConfig,
} from '../../types/ai';
import { LocalAIEngine } from '../../core/ai/LocalAIEngine';
import { IntentLearningEngine } from '../../core/ai/IntentLearningEngine';
import {
  Compass,
  Sliders,
  Shield,
  Trash2,
  RotateCcw,
  CheckCircle2,
  Save,
  Mic,
  BarChart3,
  Brain,
  Cpu,
  Sparkles,
  Plus,
  Loader2,
  AlertCircle,
} from 'lucide-react';

export const OptionsApp: React.FC = () => {
  const [profile, setProfile] = useState<CalibrationProfile>(DEFAULT_CALIBRATION_PROFILE);
  const [filterParams, setFilterParams] = useState<OneEuroParams>(DEFAULT_ONE_EURO_PARAMS);
  const [metrics, setMetrics] = useState<BenchmarkMetrics>(DEFAULT_METRICS);
  const [savedNotice, setSavedNotice] = useState<boolean>(false);

  // Local AI (Qwen) & Learning States
  const [aiConfig, setAiConfig] = useState<LocalAIConfig>(DEFAULT_LOCAL_AI_CONFIG);
  const [isTestingConnection, setIsTestingConnection] = useState<boolean>(false);
  const [connectionStatus, setConnectionStatus] = useState<{
    tested: boolean;
    connected: boolean;
    message: string;
    models: string[];
  }>({
    tested: false,
    connected: false,
    message: '',
    models: [],
  });

  // Learned Exemplars & Personal Aliases
  const [learnedExemplars, setLearnedExemplars] = useState<LearnedIntentExemplar[]>([]);
  const [aliases, setAliases] = useState<CommandAlias[]>([]);
  const [newAliasPhrase, setNewAliasPhrase] = useState<string>('');
  const [newAliasCommand, setNewAliasCommand] = useState<VoiceCommandType>('SCROLL_DOWN');
  const [newAliasQuery, setNewAliasQuery] = useState<string>('');

  useEffect(() => {
    async function load() {
      const p = await SettingsService.getCalibrationProfile();
      const f = await SettingsService.getFilterParams();
      const m = await MetricsService.getMetrics();
      const ai = await SettingsService.getLocalAIConfig();
      const ex = await SettingsService.getLearnedExemplars();
      const al = await SettingsService.getCommandAliases();

      setProfile(p);
      setFilterParams(f);
      setMetrics(m);
      setAiConfig(ai);
      setLearnedExemplars(ex);
      setAliases(al);
    }
    load();
  }, []);

  const handleResetMetrics = async () => {
    await MetricsService.resetMetrics();
    setMetrics({ ...DEFAULT_METRICS });
  };

  const handleSave = async () => {
    await SettingsService.saveCalibrationProfile(profile);
    await SettingsService.saveLocalAIConfig(aiConfig);
    LocalAIEngine.getInstance().updateConfig(aiConfig);

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({ handsfree_filter_params: filterParams });
    }
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ type: 'CALIBRATION_UPDATED', profile }).catch(() => {});
    }

    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 2500);
  };

  const handleTestAIConnection = async () => {
    setIsTestingConnection(true);
    try {
      const res = await LocalAIEngine.getInstance().testConnection(aiConfig);
      setConnectionStatus({
        tested: true,
        connected: res.connected,
        message: res.message,
        models: res.models,
      });
    } catch (e: any) {
      setConnectionStatus({
        tested: true,
        connected: false,
        message: e?.message || 'Connection test failed',
        models: [],
      });
    } finally {
      setIsTestingConnection(false);
    }
  };

  const handleAddAlias = async () => {
    if (!newAliasPhrase.trim()) return;
    await IntentLearningEngine.getInstance().teachAlias(
      newAliasPhrase.trim(),
      newAliasCommand,
      newAliasQuery.trim() || undefined
    );
    setAliases([...IntentLearningEngine.getInstance().getAliases()]);
    setLearnedExemplars([...IntentLearningEngine.getInstance().getExemplars()]);
    setNewAliasPhrase('');
    setNewAliasQuery('');
  };

  const handleDeleteAlias = async (id: string) => {
    await IntentLearningEngine.getInstance().deleteAlias(id);
    setAliases([...IntentLearningEngine.getInstance().getAliases()]);
  };

  const handleDeleteExemplar = async (id: string) => {
    await IntentLearningEngine.getInstance().deleteExemplar(id);
    setLearnedExemplars([...IntentLearningEngine.getInstance().getExemplars()]);
  };

  const handleClearLearnedPatterns = async () => {
    if (confirm('Clear all learned speech memory and personal aliases?')) {
      await SettingsService.saveLearnedExemplars([]);
      await SettingsService.saveCommandAliases([]);
      await IntentLearningEngine.getInstance().loadMemory();
      setLearnedExemplars([]);
      setAliases([]);
    }
  };

  const handleResetDefaults = async () => {
    setProfile(DEFAULT_CALIBRATION_PROFILE);
    setFilterParams(DEFAULT_ONE_EURO_PARAMS);
    setAiConfig(DEFAULT_LOCAL_AI_CONFIG);
    await SettingsService.saveCalibrationProfile(DEFAULT_CALIBRATION_PROFILE);
    await SettingsService.saveLocalAIConfig(DEFAULT_LOCAL_AI_CONFIG);
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({ handsfree_filter_params: DEFAULT_ONE_EURO_PARAMS });
    }
    setSavedNotice(true);
    setTimeout(() => setSavedNotice(false), 2500);
  };

  const handleClearData = async () => {
    if (confirm('Are you sure you want to clear all Handsfree local calibration data and settings?')) {
      if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        await chrome.storage.local.clear();
      } else {
        localStorage.clear();
      }
      setProfile(DEFAULT_CALIBRATION_PROFILE);
      setFilterParams(DEFAULT_ONE_EURO_PARAMS);
      setAiConfig(DEFAULT_LOCAL_AI_CONFIG);
      setLearnedExemplars([]);
      setAliases([]);
      alert('Local data cleared.');
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-6 py-10 min-h-screen flex flex-col justify-between">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-slate-800 pb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <Compass className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
              Handsfree
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                Preferences
              </span>
            </h1>
            <p className="text-xs text-slate-400">Customization, Local AI Brain & Calibration</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {savedNotice && (
            <span className="text-xs text-emerald-400 flex items-center gap-1 font-medium animate-pulse">
              <CheckCircle2 className="w-4 h-4" />
              Settings Saved!
            </span>
          )}
          <button
            onClick={handleSave}
            className="py-2 px-5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs flex items-center gap-2 transition-all shadow-md shadow-cyan-500/20 cursor-pointer"
          >
            <Save className="w-4 h-4" />
            Save Changes
          </button>
        </div>
      </header>

      {/* Main Settings Sections */}
      <main className="my-8 space-y-8 flex-1">
        {/* Section 1: Local AI (Qwen) Model Configuration */}
        <section className="glass-panel p-6 rounded-2xl space-y-5">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
                <Brain className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  Local AI Complex Sentence Parser (Qwen)
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    On-Device Privacy
                  </span>
                </h2>
                <p className="text-xs text-slate-400">
                  Decompose multi-step, compound instructions (e.g. "scroll down and click on sign in") using a local LLM.
                </p>
              </div>
            </div>

            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={aiConfig.enabled}
                onChange={(e) => setAiConfig({ ...aiConfig, enabled: e.target.checked })}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-cyan-500"></div>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-4 text-xs">
            {/* AI Provider */}
            <div className="space-y-1.5">
              <label className="text-slate-300 font-medium flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 text-cyan-400" />
                Local AI Provider
              </label>
              <select
                value={aiConfig.provider}
                onChange={(e) => setAiConfig({ ...aiConfig, provider: e.target.value as any })}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 text-xs focus:outline-none focus:border-cyan-400"
              >
                <option value="OLLAMA">Ollama Localhost (qwen2.5:1.5b recommended)</option>
                <option value="OPENAI_COMPATIBLE">llama.cpp / OpenAI-Compatible (127.0.0.1:8080)</option>
                <option value="HYBRID_RULE">On-Device Hybrid Neural Rule Engine (Zero Setup)</option>
              </select>
            </div>

            {/* Model Name */}
            <div className="space-y-1.5">
              <label className="text-slate-300 font-medium">Model Name / GGUF Identifier</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={aiConfig.model}
                  onChange={(e) => setAiConfig({ ...aiConfig, model: e.target.value })}
                  placeholder="e.g. qwen2.5:1.5b or qwen2.5-1.5b-instruct-q4_k_m.gguf"
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 text-xs font-mono focus:outline-none focus:border-cyan-400"
                />
              </div>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {['qwen2.5:1.5b', 'qwen2.5-1.5b-instruct-q4_k_m.gguf', 'qwen2.5:0.5b', 'qwen2.5:7b'].map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setAiConfig({ ...aiConfig, model: m })}
                    className={`text-[10px] px-2 py-0.5 rounded border transition-colors cursor-pointer ${
                      aiConfig.model === m
                        ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 font-semibold'
                        : 'bg-slate-900/60 text-slate-400 border-slate-800 hover:text-slate-200'
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>

            {/* Endpoint */}
            <div className="space-y-1.5">
              <label className="text-slate-300 font-medium">Server Endpoint URL</label>
              <input
                type="text"
                value={aiConfig.endpoint}
                onChange={(e) => setAiConfig({ ...aiConfig, endpoint: e.target.value })}
                placeholder="http://localhost:11434 or http://127.0.0.1:8080"
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-slate-200 text-xs font-mono focus:outline-none focus:border-cyan-400"
              />
            </div>

            {/* Test Connection Button */}
            <div className="space-y-1.5 flex flex-col justify-end">
              <button
                type="button"
                onClick={handleTestAIConnection}
                disabled={isTestingConnection}
                className="py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-400 border border-cyan-500/20 font-semibold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
              >
                {isTestingConnection ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Testing Qwen Connection...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    Test Connection & Detect Models
                  </>
                )}
              </button>
            </div>
          </div>

          {/* Connection Test Result Feedback */}
          {connectionStatus.tested && (
            <div
              className={`p-3.5 rounded-xl border text-xs flex items-start gap-2.5 ${
                connectionStatus.connected
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                  : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
              }`}
            >
              {connectionStatus.connected ? (
                <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400 mt-0.5" />
              ) : (
                <AlertCircle className="w-4 h-4 shrink-0 text-amber-400 mt-0.5" />
              )}
              <div className="space-y-1.5 flex-1">
                <div className="font-medium">{connectionStatus.message}</div>
                {connectionStatus.models.length > 0 && (
                  <div className="text-[11px] text-slate-400 font-mono">
                    Detected models: {connectionStatus.models.join(', ')}
                  </div>
                )}
                {!connectionStatus.connected && (
                  <div className="mt-2 pt-2 border-t border-amber-500/20 text-[11px] text-slate-300 space-y-1 font-mono">
                    <p className="font-semibold text-amber-300 font-sans">Quick Setup Instructions:</p>
                    <p>• <strong>Ollama:</strong> Run <code className="bg-slate-900 px-1 py-0.5 rounded text-cyan-300">ollama run qwen2.5:1.5b</code></p>
                    <p>• <strong>llama.cpp:</strong> Run <code className="bg-slate-900 px-1 py-0.5 rounded text-cyan-300">llama-server -m ./models/qwen2.5-1.5b-instruct-q4_k_m.gguf --port 8080 -c 4096</code></p>
                    <p>• Or execute the automated script: <code className="bg-slate-900 px-1 py-0.5 rounded text-cyan-300">.\scripts\setup-qwen.ps1</code></p>
                  </div>
                )}
              </div>
            </div>
          )}
        </section>

        {/* Section 2: Adaptive Speech Learning & Personal Aliases */}
        <section className="glass-panel p-6 rounded-2xl space-y-5">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
                <Sparkles className="w-4 h-4" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  Accent-Aware Learning & Personal Aliases
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                    Few-Shot Memory
                  </span>
                </h2>
                <p className="text-xs text-slate-400">
                  Handsfree automatically learns from your successful commands and corrections, feeding exemplars into Qwen.
                </p>
              </div>
            </div>

            {learnedExemplars.length > 0 && (
              <button
                onClick={handleClearLearnedPatterns}
                className="text-[11px] text-slate-400 hover:text-rose-400 transition-colors flex items-center gap-1 cursor-pointer"
              >
                <Trash2 className="w-3 h-3" />
                Clear Memory
              </button>
            )}
          </div>

          {/* Add Personal Alias Form */}
          <div className="bg-slate-900/60 p-4 rounded-xl border border-slate-800 space-y-3">
            <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
              <Plus className="w-3.5 h-3.5 text-cyan-400" />
              Teach Handsfree a Custom Phrase / Alias
            </span>

            <div className="grid grid-cols-3 gap-3 text-xs">
              <div>
                <label className="text-[11px] text-slate-400">Spoken Phrase</label>
                <input
                  type="text"
                  value={newAliasPhrase}
                  onChange={(e) => setNewAliasPhrase(e.target.value)}
                  placeholder='e.g. "school down" or "checkout now"'
                  className="w-full mt-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-slate-200 text-xs focus:outline-none focus:border-cyan-400"
                />
              </div>

              <div>
                <label className="text-[11px] text-slate-400">Canonical Action</label>
                <select
                  value={newAliasCommand}
                  onChange={(e) => setNewAliasCommand(e.target.value as any)}
                  className="w-full mt-1 bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-slate-200 text-xs focus:outline-none focus:border-cyan-400"
                >
                  <option value="SCROLL_DOWN">Scroll Down</option>
                  <option value="SCROLL_UP">Scroll Up</option>
                  <option value="CLICK_TARGET">Click Target</option>
                  <option value="FOCUS_INPUT">Focus Search / Input</option>
                  <option value="OPEN_SETTINGS">Open Settings</option>
                  <option value="NEW_TAB">New Tab</option>
                  <option value="CLOSE_TAB">Close Tab</option>
                  <option value="GO_BACK">Go Back</option>
                  <option value="UNDO">Undo That</option>
                </select>
              </div>

              <div>
                <label className="text-[11px] text-slate-400">Target Query (Optional)</label>
                <div className="flex gap-2 mt-1">
                  <input
                    type="text"
                    value={newAliasQuery}
                    onChange={(e) => setNewAliasQuery(e.target.value)}
                    placeholder='e.g. "Checkout"'
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg px-3 py-1.5 text-slate-200 text-xs focus:outline-none focus:border-cyan-400"
                  />
                  <button
                    type="button"
                    onClick={handleAddAlias}
                    className="px-4 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs shrink-0 transition-all cursor-pointer"
                  >
                    Add
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Learned Exemplars Table */}
          <div className="space-y-2">
            <span className="text-xs font-semibold text-slate-300">
              Active Learned Speech Patterns ({learnedExemplars.length + aliases.length})
            </span>

            {learnedExemplars.length === 0 && aliases.length === 0 ? (
              <div className="text-center py-6 border border-dashed border-slate-800 rounded-xl text-xs text-slate-500">
                No patterns learned yet. Handsfree will automatically learn compound phrases as you browse, or you can add custom phrase aliases above.
              </div>
            ) : (
              <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
                {aliases.map((a) => (
                  <div
                    key={a.id}
                    className="glass-card p-3 rounded-xl border border-cyan-500/20 flex items-center justify-between text-xs"
                  >
                    <div className="space-y-0.5">
                      <div className="font-semibold text-white flex items-center gap-2">
                        "{a.phrase}"
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                          Personal Alias
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono">
                        → {a.commandType} {a.targetQuery ? `("${a.targetQuery}")` : ''}
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteAlias(a.id)}
                      className="text-slate-500 hover:text-rose-400 p-1 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}

                {learnedExemplars.map((ex) => (
                  <div
                    key={ex.id}
                    className="glass-card p-3 rounded-xl border border-slate-800 flex items-center justify-between text-xs"
                  >
                    <div className="space-y-0.5">
                      <div className="font-semibold text-white flex items-center gap-2">
                        "{ex.rawSentence}"
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                          {Math.round(ex.confidence * 100)}% Confidence • {ex.timesUsed} uses
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono">
                        → {ex.actions.map((a) => a.type + (a.targetQuery ? `("${a.targetQuery}")` : a.text ? `("${a.text}")` : '')).join(' ➔ ')}
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteExemplar(ex.id)}
                      className="text-slate-500 hover:text-rose-400 p-1 transition-colors cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Section 3: Cursor Motion & Calibration */}
        <section className="glass-panel p-6 rounded-2xl space-y-6">
          <div className="flex items-center gap-2.5 border-b border-slate-800 pb-3">
            <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
              <Sliders className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Motion Dynamics & Sensitivity</h2>
              <p className="text-xs text-slate-400">Configure cursor response, dead zone, and One Euro filter smoothing.</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-6">
            {/* Horizontal Sensitivity */}
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-slate-300 font-medium">Horizontal Sensitivity (X)</span>
                <span className="text-cyan-400 font-mono">{profile.sensitivity.x.toFixed(2)}x</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="2.5"
                step="0.05"
                value={profile.sensitivity.x}
                onChange={(e) =>
                  setProfile({
                    ...profile,
                    sensitivity: { ...profile.sensitivity, x: parseFloat(e.target.value) },
                  })
                }
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
              />
            </div>

            {/* Vertical Sensitivity */}
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-slate-300 font-medium">Vertical Sensitivity (Y)</span>
                <span className="text-cyan-400 font-mono">{profile.sensitivity.y.toFixed(2)}x</span>
              </div>
              <input
                type="range"
                min="0.5"
                max="2.5"
                step="0.05"
                value={profile.sensitivity.y}
                onChange={(e) =>
                  setProfile({
                    ...profile,
                    sensitivity: { ...profile.sensitivity, y: parseFloat(e.target.value) },
                  })
                }
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
              />
            </div>

            {/* Dead Zone */}
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-slate-300 font-medium">Dead Zone Radius</span>
                <span className="text-cyan-400 font-mono">{(profile.deadZoneRadius * 100).toFixed(0)}%</span>
              </div>
              <input
                type="range"
                min="0.01"
                max="0.06"
                step="0.005"
                value={profile.deadZoneRadius}
                onChange={(e) =>
                  setProfile({ ...profile, deadZoneRadius: parseFloat(e.target.value) })
                }
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
              />
            </div>

            {/* Dwell Duration */}
            <div className="space-y-2">
              <div className="flex justify-between text-xs">
                <span className="text-slate-300 font-medium">Dwell Click Duration</span>
                <span className="text-cyan-400 font-mono">{(profile.dwellDurationMs / 1000).toFixed(1)}s</span>
              </div>
              <input
                type="range"
                min="600"
                max="2200"
                step="100"
                value={profile.dwellDurationMs}
                onChange={(e) =>
                  setProfile({ ...profile, dwellDurationMs: parseInt(e.target.value) })
                }
                className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
              />
            </div>
          </div>
        </section>

        {/* Section 4: Voice Reference */}
        <section className="glass-panel p-6 rounded-2xl space-y-4">
          <h2 className="text-base font-bold text-white flex items-center gap-2 border-b border-slate-800 pb-2">
            <Mic className="w-4 h-4 text-cyan-400" />
            Voice Commands & Complex Instruction Reference
          </h2>

          <div className="grid grid-cols-2 gap-3 text-xs">
            <div className="glass-card p-3.5 rounded-xl border border-slate-800 space-y-1.5">
              <span className="font-semibold text-cyan-400">Complex Sequential Instructions</span>
              <ul className="text-slate-300 space-y-1 text-[11px]">
                <li>• <strong className="text-white">"Scroll down and click on pricing"</strong></li>
                <li>• <strong className="text-white">"Search for flights to Tokyo and press enter"</strong></li>
                <li>• <strong className="text-white">"Open settings and scroll to bottom"</strong></li>
              </ul>
            </div>

            <div className="glass-card p-3.5 rounded-xl border border-slate-800 space-y-1.5">
              <span className="font-semibold text-cyan-400">Browser & Tabs Control</span>
              <ul className="text-slate-300 space-y-1 text-[11px]">
                <li>• <strong className="text-white">"New tab"</strong> / <strong className="text-white">"Close tab"</strong></li>
                <li>• <strong className="text-white">"Next tab"</strong> / <strong className="text-white">"Previous tab"</strong></li>
                <li>• <strong className="text-white">"Open settings"</strong> / <strong className="text-white">"Teach this phrase"</strong></li>
              </ul>
            </div>

            <div className="glass-card p-3.5 rounded-xl border border-slate-800 space-y-1.5">
              <span className="font-semibold text-cyan-400">Say What You See</span>
              <ul className="text-slate-300 space-y-1 text-[11px]">
                <li>• <strong className="text-white">"Click [Button Name]"</strong></li>
                <li>• <strong className="text-white">"Open the second result"</strong> (Ordinal)</li>
                <li>• <strong className="text-white">"Choose the cheapest option"</strong></li>
              </ul>
            </div>

            <div className="glass-card p-3.5 rounded-xl border border-slate-800 space-y-1.5">
              <span className="font-semibold text-cyan-400">Recovery & Safety</span>
              <ul className="text-slate-300 space-y-1 text-[11px]">
                <li>• <strong className="text-white">"Undo that"</strong> (Reverts action & trains AI)</li>
                <li>• <strong className="text-white">"Cancel"</strong> (Dismiss disambiguation)</li>
                <li>• <strong className="text-white">"Confirm"</strong> (Approve high-risk action)</li>
              </ul>
            </div>
          </div>
        </section>

        {/* Section 5: Metrics & Benchmarking Dashboard */}
        <section className="glass-panel p-6 rounded-2xl space-y-4">
          <div className="flex justify-between items-center border-b border-slate-800 pb-2">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-cyan-400" />
              Evaluation & Benchmarking Metrics
            </h2>
            <button
              onClick={handleResetMetrics}
              className="text-[11px] text-slate-400 hover:text-rose-400 transition-colors flex items-center gap-1 cursor-pointer"
            >
              <RotateCcw className="w-3 h-3" />
              Reset Metrics
            </button>
          </div>

          <div className="grid grid-cols-4 gap-3 text-center">
            <div className="glass-card p-3 rounded-xl border border-slate-800">
              <div className="text-[11px] text-slate-400">Task Success</div>
              <div className="text-lg font-bold text-emerald-400 font-mono mt-0.5">
                {Math.round(metrics.taskCompletionRate * 100)}%
              </div>
            </div>

            <div className="glass-card p-3 rounded-xl border border-slate-800">
              <div className="text-[11px] text-slate-400">Avg Latency</div>
              <div className="text-lg font-bold text-cyan-400 font-mono mt-0.5">
                {metrics.averageLatencyMs} ms
              </div>
            </div>

            <div className="glass-card p-3 rounded-xl border border-slate-800">
              <div className="text-[11px] text-slate-400">Dwell Activations</div>
              <div className="text-lg font-bold text-white font-mono mt-0.5">
                {metrics.dwellSelectionCount}
              </div>
            </div>

            <div className="glass-card p-3 rounded-xl border border-slate-800">
              <div className="text-[11px] text-slate-400">Voice Commands</div>
              <div className="text-lg font-bold text-white font-mono mt-0.5">
                {metrics.voiceCommandCount}
              </div>
            </div>
          </div>
        </section>

        {/* Section 6: Privacy & Maintenance */}
        <section className="glass-panel p-6 rounded-2xl space-y-4">
          <h2 className="text-base font-bold text-white flex items-center gap-2 border-b border-slate-800 pb-2">
            <Shield className="w-4 h-4 text-emerald-400" />
            Privacy & Data Controls
          </h2>

          <div className="space-y-3 text-xs text-slate-300">
            <p className="leading-relaxed">
              All settings, calibration profiles, and learned voice exemplars are stored solely within Chrome's local storage.
            </p>

            <div className="pt-2 flex flex-col gap-2">
              <button
                onClick={handleResetDefaults}
                className="py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-medium flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <RotateCcw className="w-4 h-4 text-cyan-400" />
                Reset All Settings to Defaults
              </button>

              <button
                onClick={handleClearData}
                className="py-2.5 px-4 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 border border-rose-500/20 text-rose-400 font-medium flex items-center justify-center gap-2 transition-all cursor-pointer"
              >
                <Trash2 className="w-4 h-4 text-rose-400" />
                Clear Local Stored Data
              </button>
            </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="text-center text-xs text-slate-500 pt-4 border-t border-slate-900">
        Handsfree • Chrome Extension Manifest V3 • GDG On Campus
      </footer>
    </div>
  );
};
