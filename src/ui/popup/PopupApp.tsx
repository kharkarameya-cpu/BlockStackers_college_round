import React, { useState, useEffect } from 'react';
import { SettingsService } from '../../core/storage/SettingsService';
import { CalibrationProfile, DEFAULT_CALIBRATION_PROFILE } from '../../types/tracking';
import {
  Compass,
  Power,
  Play,
  RotateCcw,
  Sliders,
  Shield,
  Eye,
  Target,
  Mic,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { AudioMessageLogger } from '../components/AudioMessageLogger';

export const PopupApp: React.FC = () => {
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [profile, setProfile] = useState<CalibrationProfile>(DEFAULT_CALIBRATION_PROFILE);
  const [aiConnected, setAiConnected] = useState<boolean | null>(null);
  const [showAudioLogs, setShowAudioLogs] = useState<boolean>(false);

  useEffect(() => {
    async function load() {
      const p = await SettingsService.getCalibrationProfile();
      const paused = await SettingsService.getIsPaused();
      setProfile(p);
      setIsPaused(paused);

      // Check Local AI availability
      if (typeof chrome !== 'undefined' && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ type: 'AI_CONNECTION_TEST' }, (res) => {
          if (chrome.runtime.lastError) {
            setAiConnected(false);
          } else {
            setAiConnected(Boolean(res?.connected));
          }
        });

        // Ensure tracking is initiated
        chrome.runtime.sendMessage({ type: 'START_TRACKING' }).catch(() => {});
      }
    }
    load();
  }, []);

  const togglePause = async () => {
    const nextState = !isPaused;
    setIsPaused(nextState);
    await SettingsService.setIsPaused(nextState);

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ type: 'TOGGLE_PAUSE', paused: nextState }).catch(() => {});
    }
  };

  const handleSensitivityChange = async (val: number) => {
    const updated = { ...profile, sensitivity: { x: val, y: val } };
    setProfile(updated);
    await SettingsService.saveCalibrationProfile(updated);
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ type: 'CALIBRATION_UPDATED', profile: updated }).catch(() => {});
    }
  };

  const handleDwellChange = async (val: number) => {
    const updated = { ...profile, dwellDurationMs: val };
    setProfile(updated);
    await SettingsService.saveCalibrationProfile(updated);
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ type: 'CALIBRATION_UPDATED', profile: updated }).catch(() => {});
    }
  };

  const openCalibration = () => {
    if (typeof chrome !== 'undefined' && chrome.tabs) {
      chrome.tabs.create({ url: 'onboarding.html' });
    } else {
      window.open('onboarding.html', '_blank');
    }
  };

  const recenterCursor = () => {
    if (typeof chrome !== 'undefined' && chrome.tabs && chrome.tabs.query) {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (tabs[0]?.id) {
          chrome.tabs.sendMessage(tabs[0].id, { type: 'RECENTER_CURSOR' }).catch(() => {});
        }
      });
    }
  };

  const openOptions = () => {
    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.openOptionsPage) {
      chrome.runtime.openOptionsPage();
    } else {
      window.open('options.html', '_blank');
    }
  };

  return (
    <div className="p-4 w-[360px] bg-slate-950 text-slate-100 flex flex-col justify-between min-h-[460px]">
      {/* Header */}
      <div className="space-y-4">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center shadow-md shadow-cyan-500/20">
              <Compass className="w-4 h-4 text-white" />
            </div>
            <div>
              <h1 className="font-bold text-sm tracking-tight text-white">Handsfree</h1>
              <p className="text-[10px] text-slate-400">Intent-Aware Navigation</p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-slate-900 border border-slate-800 text-[11px]">
              <span
                className={`w-1.5 h-1.5 rounded-full ${
                  aiConnected
                    ? 'bg-cyan-400 shadow-[0_0_6px_#06b6d4]'
                    : aiConnected === false
                    ? 'bg-slate-600'
                    : 'bg-amber-400'
                }`}
              />
              <span className="text-slate-400 text-[10px]">
                {aiConnected ? 'Qwen2.5 Ready' : 'AI Offline'}
              </span>
            </div>

            <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-slate-900 border border-slate-800 text-[11px]">
              <span
                className={`w-2 h-2 rounded-full ${
                  isPaused ? 'bg-amber-400 shadow-[0_0_6px_#f59e0b]' : 'bg-emerald-400 shadow-[0_0_6px_#10b981]'
                }`}
              />
              <span className="text-slate-300 font-medium">{isPaused ? 'Paused' : 'Active'}</span>
            </div>
          </div>
        </div>

        {/* Master Pause / Resume Banner */}
        <button
          onClick={togglePause}
          className={`w-full py-3 px-4 rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-lg ${
            isPaused
              ? 'bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-slate-950 shadow-emerald-500/20'
              : 'bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-400 hover:to-orange-500 text-slate-950 shadow-amber-500/20'
          }`}
        >
          {isPaused ? <Play className="w-4 h-4 fill-current" /> : <Power className="w-4 h-4" />}
          {isPaused ? 'Resume Tracking' : 'Pause Tracking (Esc)'}
        </button>

        {/* Controls Card */}
        <div className="glass-panel p-3.5 rounded-xl space-y-3.5 border border-slate-800">
          {/* Sensitivity */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-[11px] font-medium">
              <span className="text-slate-300">Sensitivity</span>
              <span className="text-cyan-400 font-mono">{profile.sensitivity.x.toFixed(2)}x</span>
            </div>
            <input
              type="range"
              min="0.5"
              max="2.5"
              step="0.05"
              value={profile.sensitivity.x}
              onChange={(e) => handleSensitivityChange(parseFloat(e.target.value))}
              className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
            />
          </div>

          {/* Dwell Duration */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-[11px] font-medium">
              <span className="text-slate-300">Dwell Click Duration</span>
              <span className="text-cyan-400 font-mono">{(profile.dwellDurationMs / 1000).toFixed(1)}s</span>
            </div>
            <input
              type="range"
              min="600"
              max="2200"
              step="100"
              value={profile.dwellDurationMs}
              onChange={(e) => handleDwellChange(parseInt(e.target.value))}
              className="w-full h-1 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
            />
          </div>
        </div>

        {/* Action Buttons */}
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={openCalibration}
            className="py-2 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 text-xs font-medium flex items-center justify-center gap-1.5 transition-all"
          >
            <RotateCcw className="w-3.5 h-3.5 text-cyan-400" />
            Recalibrate (30s)
          </button>
          <button
            onClick={recenterCursor}
            className="py-2 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 text-xs font-medium flex items-center justify-center gap-1.5 transition-all"
          >
            <Target className="w-3.5 h-3.5 text-cyan-400" />
            Recenter Center
          </button>
        </div>

        <button
          onClick={openOptions}
          className="w-full py-2 px-3 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 text-xs font-medium flex items-center justify-center gap-1.5 transition-all"
        >
          <Sliders className="w-3.5 h-3.5 text-cyan-400" />
          All Settings & Dead Zone
        </button>

        <button
          onClick={() => {
            if (typeof chrome !== 'undefined' && chrome.tabs) {
              chrome.tabs.create({ url: 'diagnostics.html' });
            } else {
              window.open('diagnostics.html', '_blank');
            }
          }}
          className="w-full py-2 px-3 rounded-xl bg-slate-900/60 hover:bg-slate-800 border border-slate-800/80 text-cyan-300 text-xs font-medium flex items-center justify-center gap-1.5 transition-all"
        >
          <Eye className="w-3.5 h-3.5 text-cyan-400" />
          Vision Diagnostics & Mesh Preview
        </button>

        {/* Audio / Voice Messages Drawer Button */}
        <button
          onClick={() => setShowAudioLogs(!showAudioLogs)}
          className="w-full py-2 px-3 rounded-xl bg-slate-900/60 hover:bg-slate-800 border border-slate-800/80 text-purple-300 text-xs font-medium flex items-center justify-between gap-1.5 transition-all"
        >
          <span className="flex items-center gap-1.5">
            <Mic className="w-3.5 h-3.5 text-purple-400" />
            Audio Messages Logger
          </span>
          {showAudioLogs ? (
            <ChevronUp className="w-3.5 h-3.5 text-slate-400" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
          )}
        </button>

        {showAudioLogs && (
          <div className="pt-1">
            <AudioMessageLogger maxHeight="220px" showSimulateButton={true} />
          </div>
        )}
      </div>

      {/* Footer info */}
      <div className="pt-3 border-t border-slate-900 flex justify-between items-center text-[10px] text-slate-500">
        <span className="flex items-center gap-1">
          <Shield className="w-3 h-3 text-emerald-400" />
          On-device perception
        </span>
        <span>v1.0.0</span>
      </div>
    </div>
  );
};
