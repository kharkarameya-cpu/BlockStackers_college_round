import React, { useState, useEffect, useRef } from 'react';
import { AudioLogger } from '../../core/speech/AudioLogger';
import { AudioLogEntry, AudioLogType } from '../../types/messages';
import {
  Mic,
  Volume2,
  Trash2,
  Download,
  Filter,
  Search,
  ChevronDown,
  ChevronRight,
  Radio,
  Play,
  CheckCircle2,
  AlertCircle,
  Clock,
  Sparkles,
} from 'lucide-react';

interface AudioMessageLoggerProps {
  maxHeight?: string;
  showSimulateButton?: boolean;
}

export const AudioMessageLogger: React.FC<AudioMessageLoggerProps> = ({
  maxHeight = '380px',
  showSimulateButton = true,
}) => {
  const [logs, setLogs] = useState<AudioLogEntry[]>([]);
  const [selectedType, setSelectedType] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [autoScroll, setAutoScroll] = useState<boolean>(true);
  const logContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const logger = AudioLogger.getInstance();
    setLogs(logger.getLogs());

    const unsubscribe = logger.subscribe((_entry, allEntries) => {
      setLogs([...allEntries]);
    });

    return () => {
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (autoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleClear = () => {
    if (confirm('Clear all recorded audio and speech logs?')) {
      AudioLogger.getInstance().clearLogs();
    }
  };

  const handleExport = () => {
    const json = AudioLogger.getInstance().exportLogs();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `handsfree-audio-logs-${new Date().toISOString().slice(0, 19)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleSimulateTestVoice = () => {
    const sampleUtterances = [
      'scroll down',
      'click the second option',
      'search for latest laptops and open details',
      'type hello world',
      'stop listening',
    ];
    const picked = sampleUtterances[Math.floor(Math.random() * sampleUtterances.length)];
    const logger = AudioLogger.getInstance();
    logger.logTranscript(picked, true, 0.94);
    if (picked.includes('and')) {
      logger.logComplexSentence(picked, 'Compound conjunction detected');
      logger.logAiActionPlan(picked, [
        { type: 'FOCUS_SEARCH', targetQuery: 'latest laptops' },
        { type: 'TYPE_TEXT', textToType: 'latest laptops' },
        { type: 'PRESS_ENTER' },
      ], 'Decomposed compound instruction into 3 actionable steps');
    } else {
      logger.logCommand({ type: picked === 'scroll down' ? 'SCROLL_DOWN' : 'CLICK', rawText: picked }, picked);
      logger.logExecution(picked === 'scroll down' ? 'SCROLL_DOWN' : 'CLICK', true, { simulated: true });
    }
  };

  const normalizedLogs = logs.map((raw: any): AudioLogEntry => {
    let type: AudioLogType = 'STATUS';
    let level: any = 'info';
    let text = '';
    let details = raw?.details;

    if (typeof raw?.type === 'object' && raw?.type !== null) {
      type = (raw.type.type as AudioLogType) || 'STATUS';
      level = raw.type.level?.toLowerCase() || 'info';
      text = raw.type.message || raw.type.text || '';
      if (raw.type.data || raw.type.details) details = raw.type.data || raw.type.details;
    } else if (typeof raw?.type === 'string') {
      type = raw.type as AudioLogType;
      level = typeof raw?.level === 'string' ? raw.level.toLowerCase() : 'info';
      text = typeof raw?.text === 'string' ? raw.text : (raw?.message || (typeof raw?.text === 'object' ? JSON.stringify(raw.text) : String(raw?.text || '')));
    }

    return {
      id: typeof raw?.id === 'string' ? raw.id : `audio-${Date.now()}-${Math.random().toString(36).substr(2, 6)}`,
      timestamp: typeof raw?.timestamp === 'number' ? raw.timestamp : Date.now(),
      type,
      level,
      text: typeof text === 'string' ? text : JSON.stringify(text || ''),
      details,
      source: typeof raw?.source === 'string' ? raw.source : undefined,
    };
  });

  const filteredLogs = normalizedLogs.filter((log) => {
    if (selectedType !== 'ALL' && log.type !== selectedType) return false;
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    const textStr = typeof log.text === 'string' ? log.text : JSON.stringify(log.text || '');
    const typeStr = typeof log.type === 'string' ? log.type : JSON.stringify(log.type || '');
    return (
      textStr.toLowerCase().includes(q) ||
      typeStr.toLowerCase().includes(q) ||
      (log.details && JSON.stringify(log.details).toLowerCase().includes(q))
    );
  });

  const getBadgeStyle = (type: AudioLogType) => {
    switch (type) {
      case 'TRANSCRIPT':
        return 'bg-blue-500/10 text-blue-400 border-blue-500/30';
      case 'COMMAND':
        return 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30';
      case 'AI_COMPLEX':
        return 'bg-purple-500/10 text-purple-300 border-purple-500/30';
      case 'AI_ACTION_PLAN':
        return 'bg-violet-500/10 text-violet-300 border-violet-500/30';
      case 'DICTATION':
        return 'bg-amber-500/10 text-amber-300 border-amber-500/30';
      case 'ERROR':
        return 'bg-rose-500/10 text-rose-400 border-rose-500/30';
      case 'EXECUTION':
        return 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30';
      case 'STATUS':
      default:
        return 'bg-slate-500/10 text-slate-400 border-slate-500/30';
    }
  };

  const formatTimestamp = (ts: number) => {
    const d = new Date(ts);
    return `${d.toLocaleTimeString([], { hour12: false })}.${String(d.getMilliseconds()).padStart(3, '0')}`;
  };

  return (
    <div className="flex flex-col bg-slate-900/90 border border-slate-800 rounded-2xl overflow-hidden backdrop-blur-xl shadow-2xl">
      {/* Top Header */}
      <div className="p-3.5 border-b border-slate-800/80 bg-slate-950/50 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
            <Mic className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-slate-100 flex items-center gap-2">
              Audio & Speech Messages Logger
              <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-800 text-cyan-300 font-mono">
                {filteredLogs.length} / {logs.length}
              </span>
            </h3>
            <p className="text-[10px] text-slate-400">Real-time transcripts, parsed voice commands, and speech events</p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {showSimulateButton && (
            <button
              onClick={handleSimulateTestVoice}
              title="Simulate a sample voice utterance to test logging"
              className="px-2 py-1 rounded-lg text-[11px] font-semibold bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-300 border border-cyan-500/30 flex items-center gap-1 transition"
            >
              <Sparkles className="w-3 h-3" />
              Test Voice
            </button>
          )}

          <button
            onClick={handleExport}
            disabled={logs.length === 0}
            title="Export logs as JSON"
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 disabled:opacity-40 transition"
          >
            <Download className="w-3.5 h-3.5" />
          </button>

          <button
            onClick={handleClear}
            disabled={logs.length === 0}
            title="Clear all logs"
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-900/30 text-slate-300 hover:text-rose-300 border border-slate-700 hover:border-rose-700/50 disabled:opacity-40 transition"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="p-2.5 border-b border-slate-800/80 bg-slate-950/30 flex items-center gap-2 text-xs flex-wrap">
        <div className="relative flex-1 min-w-[140px]">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            type="text"
            placeholder="Search transcripts, commands, errors..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-2.5 py-1 text-[11px] bg-slate-900 border border-slate-800 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
          />
        </div>

        <select
          value={selectedType}
          onChange={(e) => setSelectedType(e.target.value)}
          className="px-2 py-1 text-[11px] bg-slate-900 border border-slate-800 rounded-lg text-slate-300 focus:outline-none focus:border-cyan-500 font-mono"
        >
          <option value="ALL">All Event Types</option>
          <option value="TRANSCRIPT">Transcripts (Raw Speech)</option>
          <option value="COMMAND">Parsed Commands</option>
          <option value="AI_COMPLEX">Complex Queries</option>
          <option value="AI_ACTION_PLAN">AI Plans</option>
          <option value="DICTATION">Dictation Text</option>
          <option value="EXECUTION">Command Executions</option>
          <option value="STATUS">Speech Status</option>
          <option value="ERROR">Errors</option>
        </select>

        <label className="flex items-center gap-1.5 text-[11px] text-slate-400 select-none cursor-pointer">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            className="rounded border-slate-700 bg-slate-900 text-cyan-500 focus:ring-0 w-3 h-3"
          />
          Auto-scroll
        </label>
      </div>

      {/* Log Feed */}
      <div
        ref={logContainerRef}
        style={{ maxHeight }}
        className="overflow-y-auto p-2.5 space-y-1.5 font-mono text-[11px]"
      >
        {filteredLogs.length === 0 ? (
          <div className="py-12 text-center text-slate-500 flex flex-col items-center justify-center gap-2">
            <Volume2 className="w-6 h-6 opacity-40 text-cyan-400" />
            <p className="text-xs">No audio messages logged yet.</p>
            <p className="text-[10px] text-slate-600 max-w-[260px]">
              Speak into your microphone or click "Test Voice" to observe live audio capture and parsed intents.
            </p>
          </div>
        ) : (
          filteredLogs.map((log) => {
            const isExpanded = expandedIds.has(log.id);
            const hasDetails = log.details && Object.keys(log.details).length > 0;

            return (
              <div
                key={log.id}
                className={`p-2 rounded-xl border transition-all ${
                  log.level === 'error'
                    ? 'bg-rose-950/20 border-rose-900/40 text-rose-200'
                    : log.level === 'warn'
                    ? 'bg-amber-950/20 border-amber-900/40 text-amber-200'
                    : 'bg-slate-950/40 border-slate-800/80 hover:border-slate-700 text-slate-200'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] text-slate-500 flex items-center gap-1">
                      <Clock className="w-2.5 h-2.5" />
                      {formatTimestamp(log.timestamp)}
                    </span>

                    <span
                      className={`px-1.5 py-0.5 rounded text-[9px] font-bold border ${getBadgeStyle(
                        typeof log.type === 'string' ? log.type : 'STATUS'
                      )}`}
                    >
                      {typeof log.type === 'string' ? log.type : String((log.type as any)?.type || 'STATUS')}
                    </span>

                    {log.source && (
                      <span className="text-[9px] px-1 py-0.2 rounded bg-slate-900 text-slate-500 border border-slate-800">
                        {typeof log.source === 'string' ? log.source : JSON.stringify(log.source)}
                      </span>
                    )}
                  </div>

                  {hasDetails && (
                    <button
                      onClick={() => toggleExpand(log.id)}
                      className="text-slate-400 hover:text-cyan-400 p-0.5 transition"
                      title={isExpanded ? 'Collapse payload' : 'Expand payload details'}
                    >
                      {isExpanded ? (
                        <ChevronDown className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}
                </div>

                {/* Main text content */}
                <div className="mt-1 text-[11px] font-sans font-medium text-slate-100 break-words leading-relaxed">
                  {typeof log.text === 'string'
                    ? log.text
                    : typeof log.text === 'object'
                    ? JSON.stringify(log.text)
                    : String(log.text || '')}
                </div>

                {/* Collapsible JSON details view */}
                {isExpanded && hasDetails && (
                  <div className="mt-2 p-2 rounded-lg bg-slate-950 border border-slate-800/90 text-[10px] text-cyan-300 overflow-x-auto">
                    <pre>{JSON.stringify(log.details, null, 2)}</pre>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
