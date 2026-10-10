import React, { useState, useEffect, useRef } from 'react';
import { CameraController } from '../../core/vision/CameraController';
import { VisionProcessor } from '../../core/vision/VisionProcessor';
import { CursorEngine } from '../../core/cursor/CursorEngine';
import {
  CalibrationProfile,
  DEFAULT_CALIBRATION_PROFILE,
  TrackingTelemetry,
} from '../../types/tracking';
import { SettingsService } from '../../core/storage/SettingsService';
import { HandGesture } from '../../types/vision';
import {
  ShieldCheck,
  Video,
  Target,
  Sliders,
  CheckCircle2,
  ArrowRight,
  AlertCircle,
  Loader2,
  Hand,
  Sparkles,
} from 'lucide-react';

export const OnboardingApp: React.FC = () => {
  const [step, setStep] = useState<number>(1);
  const [cameraState, setCameraState] = useState<{ active: boolean; error: string | null }>({
    active: false,
    error: null,
  });
  const [isStartingCamera, setIsStartingCamera] = useState<boolean>(false);
  const [currentTelemetry, setCurrentTelemetry] = useState<TrackingTelemetry | null>(null);
  const [profile, setProfile] = useState<CalibrationProfile>(DEFAULT_CALIBRATION_PROFILE);

  // Target practice state
  const [activeTargetIndex, setActiveTargetIndex] = useState<number>(0);
  const [targetHits, setTargetHits] = useState<number>(0);
  const [practiceCompleted, setPracticeCompleted] = useState<boolean>(false);

  // References
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const cameraControllerRef = useRef<CameraController | null>(null);
  const visionProcessorRef = useRef<VisionProcessor | null>(null);
  const cursorEngineRef = useRef<CursorEngine | null>(null);

  const [cursorPos, setCursorPos] = useState<{ x: number; y: number; dwell: number; isPinching?: boolean }>({
    x: 0,
    y: 0,
    dwell: 0,
  });

  // Safe asset URL resolver (works both in Chrome extension unpacked dist and Vite dev)
  const getAssetUrl = (relPath: string) => {
    if (typeof chrome !== 'undefined' && chrome.runtime?.getURL) {
      return chrome.runtime.getURL(relPath);
    }
    return '/' + relPath;
  };

  // Targets for practice
  const targets = [
    { id: 0, label: 'Target 1', x: 25, y: 35 },
    { id: 1, label: 'Target 2', x: 75, y: 35 },
    { id: 2, label: 'Target 3', x: 75, y: 75 },
    { id: 3, label: 'Target 4', x: 25, y: 75 },
  ];

  // Cleanup camera and vision processor on unmount
  useEffect(() => {
    return () => {
      try {
        visionProcessorRef.current?.stop();
        cameraControllerRef.current?.stop();
      } catch (e) {
        console.warn('[Handsfree Onboarding] Unmount cleanup notice:', e);
      }
    };
  }, []);

  // Initialize camera and hand tracking
  const startCamera = async () => {
    try {
      setIsStartingCamera(true);
      setCameraState({ active: false, error: null });

      const videoEl = videoRef.current;
      if (!videoEl) {
        throw new Error('Video preview element is not ready. Please refresh the page.');
      }

      const camera = new CameraController(640, 480, 30);
      cameraControllerRef.current = camera;

      const vision = new VisionProcessor();
      vision.setTrackingMode('HAND_ONLY');
      visionProcessorRef.current = vision;
      await vision.initialize();

      await camera.start(videoEl);

      const cursorEngine = new CursorEngine(profile);
      cursorEngineRef.current = cursorEngine;

      cursorEngine.setListeners(
        (state) => {
          setCursorPos({
            x: state.x,
            y: state.y,
            dwell: state.dwellProgress,
            isPinching: state.isPinching,
          });
        },
        (clickX, clickY) => {
          handlePracticeClick(clickX, clickY);
        }
      );

      vision.start(videoEl, (result) => {
        const telemetry: TrackingTelemetry = {
          pose: {
            yaw: result.yaw,
            pitch: result.pitch,
            roll: result.roll,
            confidence: result.confidence,
            faceDetected: result.handDetected || result.faceDetected,
            timestamp: result.timestamp,
          },
          uncertaintyRadius:
            result.quality === 'OPTIMAL' ? 14 : result.quality === 'DEGRADED' ? 24 : 38,
          isTrackingStable: result.quality === 'OPTIMAL',
          trackingLost: !result.handDetected,
          trackingState: result.trackingState,
          isDwellAllowed: result.trackingState === 'TRACKING',
          handDetected: result.handDetected,
          handsCount: result.handsDetected,
          activeGesture: result.activeGesture,
          hands: result.hands,
          cursorNormalizedX: result.activeHand?.cursorNormalizedX,
          cursorNormalizedY: result.activeHand?.cursorNormalizedY,
          isPinching: result.activeHand?.isPinching,
        };

        setCurrentTelemetry(telemetry);
        cursorEngine.processTelemetry(telemetry);
      });

      setCameraState({ active: true, error: null });
      setStep(2);
    } catch (err: any) {
      console.error('[Handsfree Onboarding] Failed to start camera:', err);
      setCameraState({
        active: false,
        error:
          err?.message ||
          'Failed to access webcam. Please ensure camera permissions are allowed in Chrome.',
      });
    } finally {
      setIsStartingCamera(false);
    }
  };

  // Practice target click detection
  const handlePracticeClick = (clickX: number, clickY: number) => {
    if (step !== 4) return;
    const target = targets[activeTargetIndex];
    if (!target) return;

    // Convert target percentage to client coordinates
    const targetPxX = (target.x / 100) * window.innerWidth;
    const targetPxY = (target.y / 100) * window.innerHeight;

    const dist = Math.hypot(clickX - targetPxX, clickY - targetPxY);
    if (dist < 85) {
      advancePracticeTarget();
    }
  };

  const advancePracticeTarget = () => {
    const nextIndex = activeTargetIndex + 1;
    setTargetHits((prev) => prev + 1);
    if (nextIndex < targets.length) {
      setActiveTargetIndex(nextIndex);
    } else {
      setPracticeCompleted(true);
    }
  };

  const saveAndComplete = async () => {
    await SettingsService.saveCalibrationProfile(profile);

    try {
      visionProcessorRef.current?.stop();
      cameraControllerRef.current?.stop();
      setCameraState({ active: false, error: null });
    } catch (e) {
      console.warn('[Handsfree Onboarding] Stop camera error on completion:', e);
    }

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage) {
      chrome.runtime.sendMessage({ type: 'START_TRACKING' }).catch(() => {});
    }
    setStep(6);
  };

  // Gestures catalogue definition
  const GESTURE_CATALOGUE: {
    title: string;
    action: string;
    description: string;
    icon: string;
    imagePath?: string;
    gestureKey: HandGesture;
  }[] = [
    {
      title: 'Index Finger Pointing',
      action: 'Move Cursor',
      description: 'Point your index finger toward the screen to fluidly glide the cursor across links and buttons.',
      icon: '👆',
      imagePath: 'assets/gestures/pointing_cursor.jpg',
      gestureKey: 'POINTING',
    },
    {
      title: 'Thumb-Index Pinch',
      action: 'Click / Select',
      description: 'Bring your thumb and index fingertip together to click instantly on any button or focused link.',
      icon: '🤏',
      imagePath: 'assets/gestures/pinch_click.jpg',
      gestureKey: 'PINCH',
    },
    {
      title: 'Two Fingers Raised',
      action: 'Scroll Page',
      description: 'Raise your index and middle fingers together and move your hand up or down to scroll smoothly.',
      icon: '✌️',
      imagePath: 'assets/gestures/two_finger_scroll.jpg',
      gestureKey: 'TWO_FINGERS',
    },
    {
      title: 'Closed Fist',
      action: 'Freeze / Stop Cursor',
      description: 'Clench your hand into a closed fist to freeze the cursor in place. Great for reading or resting.',
      icon: '✊',
      gestureKey: 'CLOSED_FIST',
    },
    {
      title: 'Open Palm',
      action: 'Neutral Hover',
      description: 'Spread all five fingers to hover safely over elements without triggering accidental clicks.',
      icon: '🖐️',
      gestureKey: 'OPEN_PALM',
    },
    {
      title: 'Three Fingers Raised',
      action: 'Show Target Labels',
      description: 'Raise three fingers (index, middle, ring) to display numbered accessibility badges on all page links.',
      icon: '🤟',
      gestureKey: 'THREE_FINGERS',
    },
    {
      title: 'Thumbs Up',
      action: 'Confirm Action',
      description: 'Extend your thumb upward to approve high-impact actions, dialog prompts, or form submissions.',
      icon: '👍',
      gestureKey: 'THUMBS_UP',
    },
    {
      title: 'Thumbs Down',
      action: 'Cancel Action',
      description: 'Point your thumb downward to cancel pending modals, reset overlays, or dismiss prompts.',
      icon: '👎',
      gestureKey: 'THUMBS_DOWN',
    },
  ];

  return (
    <div className="max-w-5xl mx-auto px-6 py-8 min-h-screen flex flex-col justify-between">
      {/* Top Header */}
      <header className="flex items-center justify-between border-b border-slate-800 pb-5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center shadow-lg shadow-cyan-500/20">
            <Hand className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
              Handsfree
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                Dual-Hand Vision
              </span>
            </h1>
            <p className="text-xs text-slate-400">Hand & Dual-Hand Gesture Controlled Browser Navigation</p>
          </div>
        </div>

        {/* Stepper Indicator */}
        <div className="flex items-center gap-2 text-xs font-medium">
          {[1, 2, 3, 4, 5].map((s) => (
            <div
              key={s}
              className={`w-7 h-7 rounded-full flex items-center justify-center transition-all ${
                step === s
                  ? 'bg-cyan-500 text-slate-950 font-bold shadow-md shadow-cyan-500/30'
                  : step > s
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : 'bg-slate-800 text-slate-500'
              }`}
            >
              {step > s ? '✓' : s}
            </div>
          ))}
        </div>
      </header>

      {/* Main Content Area */}
      <main className="my-6 flex-1 flex flex-col justify-center">
        {/* Step 1: Privacy & Camera Permissions */}
        {step === 1 && (
          <div className="glass-panel p-8 rounded-2xl max-w-xl mx-auto space-y-6">
            <div className="w-14 h-14 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 mb-2">
              <ShieldCheck className="w-8 h-8" />
            </div>

            <div>
              <h2 className="text-2xl font-bold text-white tracking-tight">Camera & Privacy Setup</h2>
              <p className="text-sm text-slate-400 mt-2 leading-relaxed">
                Handsfree replaces mouse and keyboard navigation with intuitive hand tracking. Your privacy
                is strictly protected by default:
              </p>
            </div>

            <div className="space-y-3 bg-slate-900/60 p-4 rounded-xl border border-slate-800/80 text-sm">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <p className="text-slate-300">
                  <strong className="text-white">Dual-Hand Detection:</strong> Detects both your left and right hands
                  simultaneously with MediaPipe 21-point 3D landmark tracking.
                </p>
              </div>
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <p className="text-slate-300">
                  <strong className="text-white">100% On-Device Processing:</strong> Webcam frames are analyzed locally in
                  real-time via WebAssembly & GPU. Zero recordings or photos are ever saved or transmitted.
                </p>
              </div>
              <div className="flex items-start gap-3">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                <p className="text-slate-300">
                  <strong className="text-white">Zero Accidental Clicks:</strong> Closed fist immediately stops cursor motion;
                  thumb-index pinch executes clicks deliberately.
                </p>
              </div>
            </div>

            {cameraState.error && (
              <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{cameraState.error}</span>
              </div>
            )}

            <button
              onClick={startCamera}
              disabled={isStartingCamera}
              className="w-full py-3.5 px-6 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold transition-all shadow-lg shadow-cyan-500/25 flex items-center justify-center gap-2 disabled:opacity-60 cursor-pointer"
            >
              {isStartingCamera ? (
                <>
                  <Loader2 className="w-5 h-5 animate-spin" />
                  Initializing Hand AI Engine...
                </>
              ) : (
                <>
                  <Video className="w-5 h-5" />
                  Enable Camera & View Hand Movements
                </>
              )}
            </button>
          </div>
        )}

        {/* Step 2: Hand Movement & Gesture Catalogue */}
        {step === 2 && (
          <div className="glass-panel p-8 rounded-2xl max-w-4xl mx-auto space-y-6">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                    STEP 2
                  </span>
                  <h2 className="text-2xl font-bold text-white tracking-tight">Hand Movements & Gestures</h2>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  Control the browser completely hands-free with these intuitive hand movements. You can use either hand, or both!
                </p>
              </div>

              <button
                onClick={() => setStep(3)}
                className="py-2.5 px-6 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold text-sm transition-all shadow-lg shadow-cyan-500/20 flex items-center gap-2 shrink-0 cursor-pointer"
              >
                Test Live Tracking
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>

            {/* Gesture Cards Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {GESTURE_CATALOGUE.map((g) => {
                const isActive = currentTelemetry?.activeGesture === g.gestureKey;
                return (
                  <div
                    key={g.title}
                    className={`rounded-2xl border transition-all duration-300 p-4 flex flex-col justify-between overflow-hidden relative ${
                      isActive
                        ? 'bg-cyan-950/40 border-cyan-400 shadow-lg shadow-cyan-500/20 scale-[1.02]'
                        : 'bg-slate-900/60 border-slate-800/80 hover:border-slate-700'
                    }`}
                  >
                    {isActive && (
                      <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full bg-cyan-400 text-slate-950 text-[10px] font-bold animate-pulse">
                        ACTIVE NOW
                      </div>
                    )}

                    <div>
                      {/* Gesture illustration photo or icon */}
                      {g.imagePath ? (
                        <div className="w-full h-32 rounded-xl overflow-hidden mb-3 bg-slate-950 border border-slate-800 relative group">
                          <img
                            src={getAssetUrl(g.imagePath)}
                            alt={g.title}
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                          />
                          <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-transparent to-transparent opacity-60" />
                          <div className="absolute bottom-2 left-2 text-xl">{g.icon}</div>
                        </div>
                      ) : (
                        <div className="w-12 h-12 rounded-xl bg-slate-800/80 border border-slate-700 flex items-center justify-center text-2xl mb-3">
                          {g.icon}
                        </div>
                      )}

                      <div className="flex items-center justify-between">
                        <h3 className="font-bold text-white text-sm">{g.title}</h3>
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded bg-slate-800 text-cyan-400 font-mono">
                          {g.action}
                        </span>
                      </div>
                      <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">{g.description}</p>
                    </div>

                    <div className="mt-3 pt-2 border-t border-slate-800/60 flex items-center justify-between text-[11px] text-slate-500">
                      <span>Both Hands Supported</span>
                      <span className="font-mono text-cyan-500/80">{g.gestureKey}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Bottom Callout */}
            <div className="p-4 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Sparkles className="w-5 h-5 text-cyan-400 shrink-0" />
                <p className="text-xs text-slate-300">
                  <strong className="text-white">Dual-Hand Synergy:</strong> Use your right hand to point the cursor and your
                  left hand to give a Thumbs Up to confirm, or switch hands anytime!
                </p>
              </div>
              <button
                onClick={() => setStep(3)}
                className="py-2 px-5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs transition-all cursor-pointer shrink-0"
              >
                Proceed to Live Test
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Live Dual-Hand Detection Test */}
        {step === 3 && (
          <div className="glass-panel p-8 rounded-2xl max-w-2xl mx-auto space-y-6 text-center">
            <div>
              <div className="flex items-center justify-center gap-2 mb-1">
                <span className="text-xs font-bold px-2 py-0.5 rounded bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                  STEP 3
                </span>
                <h2 className="text-2xl font-bold text-white tracking-tight">Dual-Hand Detection Playground</h2>
              </div>
              <p className="text-xs text-slate-400">
                Raise your hands in front of the camera. Try pointing, pinching, raising two fingers, or making a fist!
              </p>
            </div>

            {/* Video preview container spacing */}
            <div className="h-64" />

            {/* Live Dual-Hand Telemetry Box */}
            <div className="grid grid-cols-2 gap-4 text-left">
              <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800">
                <div className="text-xs text-slate-400">Hands In Camera View</div>
                <div className="text-xl font-bold text-cyan-400 mt-1 flex items-center gap-2">
                  <Hand className="w-5 h-5" />
                  {currentTelemetry?.handsCount || (currentTelemetry?.handDetected ? 1 : 0)} Hand(s)
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  {currentTelemetry?.handsCount === 2
                    ? 'Dual-Hand Mode: Both hands active'
                    : 'Show second hand anytime to enable dual control'}
                </p>
              </div>

              <div className="p-4 rounded-xl bg-slate-900/80 border border-slate-800">
                <div className="text-xs text-slate-400">Detected Gesture</div>
                <div className="text-xl font-bold text-emerald-400 mt-1 font-mono flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-ping" />
                  {currentTelemetry?.activeGesture || 'READY'}
                </div>
                <p className="text-[11px] text-slate-500 mt-1">
                  Pinch state: {currentTelemetry?.isPinching ? 'PINCHING (CLICK)' : 'Open / Hover'}
                </p>
              </div>
            </div>

            <button
              onClick={() => setStep(4)}
              className="w-full py-3.5 px-6 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold transition-all shadow-lg shadow-cyan-500/25 flex items-center justify-center gap-2 cursor-pointer"
            >
              Continue to Target Practice
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Step 4: Interactive Target Practice */}
        {step === 4 && (
          <div className="relative min-h-[480px] border border-cyan-500/20 rounded-2xl bg-slate-900/40 p-6 flex flex-col justify-between overflow-hidden">
            {/* Header info */}
            <div className="flex justify-between items-center text-sm z-10">
              <span className="font-semibold text-white flex items-center gap-2">
                <Target className="w-4 h-4 text-cyan-400" />
                Target Practice: Move hand to aim & Pinch fingers (or dwell) to hit targets
              </span>
              <div className="flex items-center gap-3">
                <span className="font-mono text-cyan-400">
                  Hits: {targetHits} / {targets.length}
                </span>
                <button
                  onClick={() => setStep(5)}
                  className="text-xs text-slate-400 hover:text-white underline cursor-pointer"
                >
                  Skip Practice
                </button>
              </div>
            </div>

            {/* Target dots */}
            {targets.map((tgt, i) => (
              <div
                key={tgt.id}
                onClick={() => i === activeTargetIndex && advancePracticeTarget()}
                className={`absolute w-16 h-16 rounded-full flex items-center justify-center font-bold text-xs transition-all duration-300 transform -translate-x-1/2 -translate-y-1/2 cursor-pointer ${
                  i === activeTargetIndex
                    ? 'bg-cyan-500 text-slate-950 shadow-xl shadow-cyan-500/50 scale-110 animate-pulse-subtle'
                    : i < activeTargetIndex
                    ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 scale-90'
                    : 'bg-slate-800 text-slate-500 border border-slate-700'
                }`}
                style={{ left: `${tgt.x}%`, top: `${tgt.y}%` }}
              >
                {i < activeTargetIndex ? '✓' : tgt.label}
              </div>
            ))}

            {/* Virtual cursor indicator in practice mode */}
            <div
              className="fixed pointer-events-none z-50 transform -translate-x-1/2 -translate-y-1/2 transition-[transform] duration-75"
              style={{ left: `${cursorPos.x}px`, top: `${cursorPos.y}px` }}
            >
              <div
                className={`w-9 h-9 rounded-full border-2 flex items-center justify-center shadow-lg transition-all ${
                  cursorPos.isPinching
                    ? 'border-emerald-400 bg-emerald-500/30 scale-125 shadow-emerald-400/50'
                    : 'border-cyan-400/80 bg-cyan-500/10 shadow-cyan-400/30'
                }`}
              >
                <div
                  className={`w-3 h-3 rounded-full shadow-md ${
                    cursorPos.isPinching ? 'bg-emerald-400 shadow-emerald-400' : 'bg-cyan-400 shadow-cyan-400'
                  }`}
                />
              </div>

              {/* Dwell ring */}
              {cursorPos.dwell > 0 && (
                <svg className="absolute -inset-1 w-11 h-11 -rotate-90">
                  <circle
                    cx="22"
                    cy="22"
                    r="17"
                    fill="none"
                    stroke="#38bdf8"
                    strokeWidth="3"
                    strokeDasharray="106.8"
                    strokeDashoffset={106.8 - cursorPos.dwell * 106.8}
                  />
                </svg>
              )}
            </div>

            {practiceCompleted && (
              <div className="z-10 bg-slate-950/90 backdrop-blur-md p-6 rounded-2xl border border-emerald-500/30 text-center max-w-sm mx-auto shadow-2xl">
                <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-2" />
                <h3 className="font-bold text-white text-lg">Practice Complete!</h3>
                <p className="text-xs text-slate-400 mt-1">
                  Hand cursor tracking and pinch-click activation are verified and working cleanly.
                </p>
                <button
                  onClick={() => setStep(5)}
                  className="mt-4 w-full py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-sm transition-all shadow-md shadow-cyan-500/20 cursor-pointer"
                >
                  Tune Sensitivity & Settings
                </button>
              </div>
            )}
          </div>
        )}

        {/* Step 5: Sensitivity & Pinch Timing Tuning */}
        {step === 5 && (
          <div className="glass-panel p-8 rounded-2xl max-w-xl mx-auto space-y-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
                <Sliders className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-white">Fine-Tune Hand Settings</h2>
                <p className="text-xs text-slate-400">Adjust hand sensitivity and dwell fallback timing.</p>
              </div>
            </div>

            <div className="space-y-5">
              {/* Hand Cursor Sensitivity */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-medium">
                  <span className="text-slate-300">Hand Cursor Sensitivity</span>
                  <span className="text-cyan-400 font-mono">{profile.sensitivity.x.toFixed(2)}x</span>
                </div>
                <input
                  type="range"
                  min="0.6"
                  max="2.5"
                  step="0.05"
                  value={profile.sensitivity.x}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    const updated = { ...profile, sensitivity: { x: val, y: val } };
                    setProfile(updated);
                    if (cursorEngineRef.current) cursorEngineRef.current.setCalibrationProfile(updated);
                  }}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                />
              </div>

              {/* Dwell Fallback Duration */}
              <div className="space-y-2">
                <div className="flex justify-between text-xs font-medium">
                  <span className="text-slate-300">Dwell Fallback Duration</span>
                  <span className="text-cyan-400 font-mono">{(profile.dwellDurationMs / 1000).toFixed(1)}s</span>
                </div>
                <input
                  type="range"
                  min="600"
                  max="2200"
                  step="100"
                  value={profile.dwellDurationMs}
                  onChange={(e) => {
                    const val = parseInt(e.target.value);
                    const updated = { ...profile, dwellDurationMs: val };
                    setProfile(updated);
                    if (cursorEngineRef.current) cursorEngineRef.current.setCalibrationProfile(updated);
                  }}
                  className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-cyan-400"
                />
              </div>
            </div>

            <button
              onClick={saveAndComplete}
              className="w-full py-3.5 px-6 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold transition-all shadow-lg shadow-cyan-500/25 flex items-center justify-center gap-2 cursor-pointer"
            >
              <CheckCircle2 className="w-5 h-5" />
              Save Preferences & Complete Setup
            </button>
          </div>
        )}

        {/* Step 6: Confirmation Screen */}
        {step === 6 && (
          <div className="glass-panel p-10 rounded-2xl max-w-lg mx-auto text-center space-y-5">
            <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 mx-auto">
              <CheckCircle2 className="w-10 h-10" />
            </div>

            <h2 className="text-2xl font-bold text-white tracking-tight">You're Ready to Browse!</h2>
            <p className="text-sm text-slate-400 leading-relaxed">
              Handsfree Dual-Hand Tracking is now active. Open any webpage in Chrome — point your hand to glide the cursor,
              pinch to click, and raise two fingers to scroll.
            </p>

            <div className="p-4 rounded-xl bg-slate-900/60 border border-slate-800 text-xs text-slate-300 space-y-1.5 text-left">
              <div className="font-semibold text-white">Hand Gesture Cheat Sheet:</div>
              <div>• 👆 <strong>Point index:</strong> Move in-page cursor</div>
              <div>• 🤏 <strong>Pinch:</strong> Click or activate button</div>
              <div>• ✌️ <strong>Two fingers:</strong> Scroll page up or down</div>
              <div>• ✊ <strong>Closed fist:</strong> Freeze / stop cursor movement</div>
              <div>• 👍 <strong>Thumbs up:</strong> Confirm action or form</div>
              <div>• 👎 <strong>Thumbs down:</strong> Cancel action</div>
            </div>

            <button
              onClick={() => window.close()}
              className="w-full py-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-sm transition-all shadow-lg shadow-cyan-500/20 cursor-pointer"
            >
              Close Setup Tab & Start Browsing
            </button>
          </div>
        )}
      </main>

      {/* Persistent Video Preview Box */}
      <div
        className={`transition-all duration-300 ${
          step === 3
            ? 'fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-16 w-96 h-72 rounded-2xl overflow-hidden border-2 border-cyan-500/50 bg-slate-950 shadow-2xl z-30'
            : step === 4
            ? 'fixed bottom-6 right-6 w-56 h-40 rounded-2xl overflow-hidden border-2 border-cyan-500/40 bg-slate-950 shadow-2xl z-40'
            : 'fixed -top-[9999px] -left-[9999px] w-[320px] h-[240px] opacity-0 pointer-events-none'
        }`}
      >
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          className="w-full h-full object-cover transform scale-x-[-1]"
        />

        {/* Floating live tracking badge */}
        {(step === 3 || step === 4) && (
          <div className="absolute top-2 left-2 px-2.5 py-1 rounded-md bg-slate-950/85 backdrop-blur-md border border-slate-800 text-[10px] font-bold text-cyan-400 flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
            {currentTelemetry?.handsCount === 2 ? 'Both Hands Detected' : 'Dual-Hand AI Active'}
          </div>
        )}

        {/* Real-time confidence badge when camera is visible */}
        {(step === 3 || step === 4) && (
          <div className="absolute bottom-2 left-2 right-2 flex justify-between items-center text-[11px] px-2.5 py-1 rounded bg-slate-950/85 backdrop-blur-md border border-slate-800">
            <span className="flex items-center gap-1 text-slate-300">
              <Hand className="w-3.5 h-3.5 text-cyan-400" />
              {currentTelemetry?.handDetected ? `${currentTelemetry?.handsCount || 1} Hand(s)` : 'Detecting Hands...'}
            </span>
            <span className="text-emerald-400 font-mono font-bold">
              {currentTelemetry?.activeGesture || 'READY'}
            </span>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="text-center text-xs text-slate-500 pt-4 border-t border-slate-900">
        Handsfree Accessible Dual-Hand Browsing • GDG On Campus
      </footer>
    </div>
  );
};
