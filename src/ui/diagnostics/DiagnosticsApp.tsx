import React, { useState, useEffect, useRef } from 'react';
import { CameraController } from '../../core/vision/CameraController';
import { VisionProcessor } from '../../core/vision/VisionProcessor';
import { VisionDiagnostics, DiagnosticRenderOptions } from '../../core/vision/VisionDiagnostics';
import { TrackingResult, CameraDiagnosticMetrics } from '../../types/vision';
import { CursorEngine, CursorState } from '../../core/cursor/CursorEngine';
import { AudioMessageLogger } from '../components/AudioMessageLogger';
import {
  Video,
  VideoOff,
  Activity,
  Layers,
  Compass,
  AlertTriangle,
  AlertCircle,
  Sliders,
  Cpu,
  Radio,
  CheckCircle2,
  XCircle,
} from 'lucide-react';

export const DiagnosticsApp: React.FC = () => {
  const [metrics, setMetrics] = useState<CameraDiagnosticMetrics>({
    status: 'IDLE',
    errorMessage: null,
    fps: 0,
    frameLatencyMs: 0,
    videoWidth: 0,
    videoHeight: 0,
  });

  const [trackingResult, setTrackingResult] = useState<TrackingResult | null>(null);
  const [cursorState, setCursorState] = useState<CursorState | null>(null);
  const [activeTabInfo, setActiveTabInfo] = useState<{
    id: number | null;
    url: string;
    isEligible: boolean;
    isReady: boolean;
    lastMessageTime: number | null;
  }>({
    id: null,
    url: '',
    isEligible: false,
    isReady: false,
    lastMessageTime: null,
  });

  const [options, setOptions] = useState<DiagnosticRenderOptions>({
    showMesh: true,
    showContours: true,
    showIris: true,
    showPoseTriad: true,
    showBoundingBox: true,
  });

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cameraControllerRef = useRef<CameraController | null>(null);
  const visionProcessorRef = useRef<VisionProcessor | null>(null);
  const diagnosticsRef = useRef<VisionDiagnostics | null>(null);
  const cursorEngineRef = useRef<CursorEngine | null>(null);

  // Initialize controllers
  useEffect(() => {
    const camera = new CameraController(640, 480, 30);
    const vision = new VisionProcessor(camera);
    const cursor = new CursorEngine();
    
    cameraControllerRef.current = camera;
    visionProcessorRef.current = vision;
    cursorEngineRef.current = cursor;

    cursor.setListeners((state) => {
      setCursorState(state);
    });

    const unsubscribe = camera.subscribe((m) => {
      setMetrics({ ...m });
    });

    // Check active tab readiness via Chrome API
    if (typeof chrome !== 'undefined' && chrome.tabs?.query) {
      chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
        const t = tabs[0];
        if (t && t.id) {
          const url = t.url || '';
          const isEligible = !url.startsWith('chrome://') && !url.startsWith('chrome-extension://') && (url.startsWith('http://') || url.startsWith('https://'));
          setActiveTabInfo({
            id: t.id,
            url,
            isEligible,
            isReady: isEligible,
            lastMessageTime: Date.now(),
          });
        }
      });
    }

    return () => {
      unsubscribe();
      vision.dispose();
      camera.dispose();
    };
  }, []);

  const startCamera = async () => {
    const camera = cameraControllerRef.current;
    const vision = visionProcessorRef.current;
    if (!camera || !vision) return;

    try {
      if (canvasRef.current) {
        diagnosticsRef.current = new VisionDiagnostics(canvasRef.current);
      }

      // Step 1: Initialize MediaPipe WASM and models
      await vision.initialize();

      // Step 2: Request user media on explicit user gesture
      const videoEl = videoRef.current;
      if (!videoEl) return;

      await camera.start(videoEl);

      // Step 3: Start frame processing
      vision.start(videoEl, (result, rawLandmarks) => {
        setTrackingResult(result);

        // Process telemetry to display cursor smoothing data
        cursorEngineRef.current?.processTelemetry({
          pose: {
            yaw: result.yaw,
            pitch: result.pitch,
            roll: result.roll,
            confidence: result.confidence,
            faceDetected: result.faceDetected,
            timestamp: result.timestamp,
          },
          uncertaintyRadius: result.quality === 'OPTIMAL' ? 14 : result.quality === 'DEGRADED' ? 24 : 38,
          isTrackingStable: result.quality === 'OPTIMAL',
          trackingLost: !result.handDetected && !result.faceDetected,
          trackingState: result.trackingState,
          isDwellAllowed: result.trackingState === 'TRACKING',
          faceDetected: result.faceDetected,
          faceStatus: result.faceStatus,
          handStatus: result.handStatus,
          faceError: result.faceError,
          handError: result.handError,
          activeSource: result.activeSource,
          handDetected: result.handDetected,
          handsCount: result.handsDetected,
          activeGesture: result.activeGesture,
          hands: result.hands,
          cursorNormalizedX: result.cursorNormalizedX,
          cursorNormalizedY: result.cursorNormalizedY,
          isPinching: result.activeHand?.isPinching,
        });

        if (diagnosticsRef.current && videoEl) {
          diagnosticsRef.current.render(videoEl, rawLandmarks, result, options);
        }
      });
    } catch (err: any) {
      console.error('[Handsfree Diagnostics] Start camera error:', err);
    }
  };

  const stopCamera = () => {
    const camera = cameraControllerRef.current;
    const vision = visionProcessorRef.current;
    if (vision) vision.stop();
    if (camera) camera.stop();
    setTrackingResult(null);

    // Clear canvas
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
  };

  const getQualityColor = (quality?: string) => {
    switch (quality) {
      case 'OPTIMAL':
        return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30';
      case 'DEGRADED':
        return 'text-amber-400 bg-amber-500/10 border-amber-500/30';
      case 'INSUFFICIENT':
        return 'text-rose-400 bg-rose-500/10 border-rose-500/30';
      case 'LOST':
      default:
        return 'text-slate-400 bg-slate-800 border-slate-700';
    }
  };

  const getStatusBadge = (status?: string) => {
    switch (status) {
      case 'TRACKING':
      case 'READY':
      case 'ACTIVE':
        return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30';
      case 'LOADING':
      case 'REQUESTING_PERMISSION':
        return 'text-cyan-400 bg-cyan-500/10 border-cyan-500/30 animate-pulse';
      case 'NOT_VISIBLE':
        return 'text-amber-400 bg-amber-500/10 border-amber-500/30';
      case 'ERROR':
      case 'PERMISSION_DENIED':
      case 'DEVICE_DISCONNECTED':
        return 'text-rose-400 bg-rose-500/10 border-rose-500/30';
      default:
        return 'text-slate-400 bg-slate-900 border-slate-800';
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 min-h-screen flex flex-col justify-between">
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
                Independent Vision Diagnostics
              </span>
            </h1>
            <p className="text-xs text-slate-400">MediaPipe Face & Dual-Hand Independent Pipeline Health</p>
          </div>
        </div>

        {/* Global Status Pill */}
        <div className="flex items-center gap-2">
          <span
            className={`px-3 py-1 rounded-full text-xs font-semibold border flex items-center gap-1.5 ${getStatusBadge(
              metrics.status
            )}`}
          >
            <span
              className={`w-2 h-2 rounded-full ${
                metrics.status === 'ACTIVE'
                  ? 'bg-emerald-400 shadow-[0_0_6px_#10b981]'
                  : metrics.status === 'PERMISSION_DENIED'
                  ? 'bg-rose-400'
                  : 'bg-slate-500'
              }`}
            />
            Camera: {metrics.status}
          </span>
        </div>
      </header>

      {/* Error / Warning Alert Banner */}
      {metrics.errorMessage && (
        <div className="my-4 p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 text-rose-300 text-xs flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-rose-400 shrink-0" />
          <div>
            <div className="font-semibold text-rose-200">Camera Exception</div>
            <div>{metrics.errorMessage}</div>
          </div>
        </div>
      )}

      {/* Main Grid View */}
      <main className="my-6 grid grid-cols-1 lg:grid-cols-12 gap-6 flex-1">
        {/* Left Column: Video & Diagnostic Canvas (7 Cols) */}
        <div className="lg:col-span-7 flex flex-col space-y-4">
          <div className="relative w-full aspect-[4/3] bg-slate-900 rounded-2xl overflow-hidden border border-slate-800 shadow-2xl flex items-center justify-center">
            {/* Hidden Source Video */}
            <video ref={videoRef} autoPlay playsInline muted className="hidden" />

            {/* Diagnostic Canvas Overlay */}
            <canvas ref={canvasRef} width={640} height={480} className="w-full h-full object-cover" />

            {/* Inactive Placeholder */}
            {metrics.status !== 'ACTIVE' && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/80 p-6 text-center space-y-3">
                <div className="w-16 h-16 rounded-2xl bg-slate-900 border border-slate-800 flex items-center justify-center text-slate-500">
                  <VideoOff className="w-8 h-8" />
                </div>
                <div>
                  <h3 className="font-bold text-white text-base">Camera Inactive</h3>
                  <p className="text-xs text-slate-400 max-w-sm mt-1">
                    Click "Start Camera" below to request webcam access and verify face and hand tracking pipelines independently.
                  </p>
                </div>
              </div>
            )}

            {/* Stream HUD Bar */}
            {metrics.status === 'ACTIVE' && (
              <div className="absolute top-3 left-3 right-3 flex justify-between items-center text-[11px] px-3 py-1.5 rounded-lg bg-slate-950/80 backdrop-blur-md border border-slate-800 text-slate-300">
                <span className="flex items-center gap-1.5 font-mono">
                  <Cpu className="w-3.5 h-3.5 text-cyan-400" />
                  {metrics.fps} FPS • {metrics.frameLatencyMs.toFixed(1)}ms latency
                </span>
                <span className="font-mono text-slate-400">
                  {metrics.videoWidth}x{metrics.videoHeight}
                </span>
              </div>
            )}
          </div>

          {/* Action Bar */}
          <div className="flex items-center gap-3">
            {metrics.status !== 'ACTIVE' ? (
              <button
                onClick={startCamera}
                disabled={metrics.status === 'REQUESTING_PERMISSION' || metrics.status === 'INITIALIZING_VISION'}
                className="flex-1 py-3 px-6 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold text-xs flex items-center justify-center gap-2 shadow-lg shadow-cyan-500/25 transition-all disabled:opacity-50"
              >
                <Video className="w-4 h-4" />
                {metrics.status === 'REQUESTING_PERMISSION'
                  ? 'Requesting Camera...'
                  : metrics.status === 'INITIALIZING_VISION'
                  ? 'Loading MediaPipe Tasks...'
                  : 'Start Camera'}
              </button>
            ) : (
              <button
                onClick={stopCamera}
                className="flex-1 py-3 px-6 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs flex items-center justify-center gap-2 transition-all"
              >
                <VideoOff className="w-4 h-4 text-rose-400" />
                Stop Camera
              </button>
            )}
          </div>

          {/* Diagnostic Overlay Toggles */}
          <div className="glass-panel p-4 rounded-xl border border-slate-800 space-y-2.5">
            <div className="text-xs font-semibold text-slate-300 flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-cyan-400" />
              Diagnostic Overlays
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
              <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                <input
                  type="checkbox"
                  checked={options.showMesh}
                  onChange={(e) => setOptions({ ...options, showMesh: e.target.checked })}
                  className="rounded border-slate-700 text-cyan-500 focus:ring-0"
                />
                Hand Skeleton & Connectors
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                <input
                  type="checkbox"
                  checked={options.showPoseTriad}
                  onChange={(e) => setOptions({ ...options, showPoseTriad: e.target.checked })}
                  className="rounded border-slate-700 text-cyan-500 focus:ring-0"
                />
                Pointer Ray & Vectors
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-slate-300">
                <input
                  type="checkbox"
                  checked={options.showBoundingBox}
                  onChange={(e) => setOptions({ ...options, showBoundingBox: e.target.checked })}
                  className="rounded border-slate-700 text-cyan-500 focus:ring-0"
                />
                Bounding Boxes
              </label>
            </div>
          </div>
        </div>

        {/* Right Column: Independent Diagnostic Metrics (5 Cols) */}
        <div className="lg:col-span-5 flex flex-col space-y-4">
          {/* Card 1: Face Detector Status */}
          <div className="glass-panel p-4 rounded-2xl border border-slate-800 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                <Activity className="w-4 h-4 text-cyan-400" />
                Face Landmarker Pipeline
              </span>
              <span
                className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${getStatusBadge(
                  trackingResult?.faceStatus || visionProcessorRef.current?.getFaceStatus()
                )}`}
              >
                {trackingResult?.faceStatus || visionProcessorRef.current?.getFaceStatus() || 'UNINITIALIZED'}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="glass-card p-2 rounded-xl border border-slate-800">
                <div className="text-slate-400 text-[10px]">Face Result</div>
                <div className="font-bold text-white mt-0.5 flex items-center gap-1">
                  {trackingResult?.faceDetected ? (
                    <>
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                      Detected
                    </>
                  ) : (
                    <>
                      <XCircle className="w-3.5 h-3.5 text-slate-500" />
                      Not Visible
                    </>
                  )}
                </div>
              </div>
              <div className="glass-card p-2 rounded-xl border border-slate-800">
                <div className="text-slate-400 text-[10px]">Last Detection Age</div>
                <div className="font-mono text-cyan-400 font-bold mt-0.5">
                  {trackingResult?.lastFaceDetectionTime
                    ? `${Math.max(0, Math.round((performance.now() - trackingResult.lastFaceDetectionTime) / 100) / 10)}s ago`
                    : 'None'}
                </div>
              </div>
            </div>
          </div>

          {/* Card 2: Hand Detector Status */}
          <div className="glass-panel p-4 rounded-2xl border border-slate-800 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                <Activity className="w-4 h-4 text-emerald-400" />
                Hand Landmarker Pipeline
              </span>
              <span
                className={`px-2.5 py-0.5 rounded-full text-[11px] font-bold border ${getStatusBadge(
                  trackingResult?.handStatus || visionProcessorRef.current?.getHandStatus()
                )}`}
              >
                {trackingResult?.handStatus || visionProcessorRef.current?.getHandStatus() || 'UNINITIALIZED'}
              </span>
            </div>

            <div className="grid grid-cols-3 gap-2 text-xs">
              <div className="glass-card p-2 rounded-xl border border-slate-800">
                <div className="text-slate-400 text-[10px]">Hands Count</div>
                <div className="font-bold text-white mt-0.5">
                  {trackingResult?.handsDetected || 0}
                </div>
              </div>
              <div className="glass-card p-2 rounded-xl border border-slate-800">
                <div className="text-slate-400 text-[10px]">Active Gesture</div>
                <div className="font-bold text-amber-400 mt-0.5 font-mono text-[11px]">
                  {trackingResult?.activeGesture || 'NONE'}
                </div>
              </div>
              <div className="glass-card p-2 rounded-xl border border-slate-800">
                <div className="text-slate-400 text-[10px]">Last Hand Age</div>
                <div className="font-mono text-cyan-400 font-bold mt-0.5">
                  {trackingResult?.lastHandDetectionTime
                    ? `${Math.max(0, Math.round((performance.now() - trackingResult.lastHandDetectionTime) / 100) / 10)}s ago`
                    : 'None'}
                </div>
              </div>
            </div>
          </div>

          {/* Card 3: Cursor Output & Coordinate Telemetry */}
          <div className="glass-panel p-4 rounded-2xl border border-slate-800 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                <Compass className="w-4 h-4 text-cyan-400" />
                Cursor Output & Coordinates
              </span>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-900 border border-slate-800 text-cyan-300">
                Source: {trackingResult?.activeSource || 'NONE'}
              </span>
            </div>

            <div className="space-y-2 text-xs font-mono">
              <div className="flex justify-between text-[11px]">
                <span className="text-slate-400 font-sans">Raw Cursor (X, Y)</span>
                <span className="text-cyan-400">
                  {cursorState ? `${Math.round(cursorState.rawX)}, ${Math.round(cursorState.rawY)}` : '0, 0'}
                </span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-slate-400 font-sans">Filtered Cursor (X, Y)</span>
                <span className="text-cyan-400">
                  {cursorState ? `${Math.round(cursorState.x)}, ${Math.round(cursorState.y)}` : '0, 0'}
                </span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-slate-400 font-sans">Confidence Score</span>
                <span className="text-emerald-400 font-bold">
                  {trackingResult ? `${Math.round(trackingResult.confidence * 100)}%` : '0%'}
                </span>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-slate-400 font-sans">Outliers Rejected</span>
                <span className="text-amber-400 font-bold">
                  {cursorState?.outlierCount || 0}
                </span>
              </div>
            </div>
          </div>

          {/* Card 4: Runtime Messaging & Active Tab Health */}
          <div className="glass-panel p-4 rounded-2xl border border-slate-800 space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                <Radio className="w-4 h-4 text-blue-400" />
                Active Tab & Runtime Messaging
              </span>
              <span
                className={`px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                  activeTabInfo.isReady
                    ? 'text-emerald-400 bg-emerald-500/10 border-emerald-500/30'
                    : 'text-amber-400 bg-amber-500/10 border-amber-500/30'
                }`}
              >
                {activeTabInfo.isReady ? 'Connected' : 'Handshaking / Restricted'}
              </span>
            </div>

            <div className="text-xs space-y-1 text-slate-300">
              <div className="flex justify-between">
                <span className="text-slate-400">Active Tab URL</span>
                <span className="truncate max-w-[200px] text-cyan-300 font-mono text-[10px]">
                  {activeTabInfo.url || 'No active eligible tab'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Page Eligibility</span>
                <span className="font-semibold text-white">
                  {activeTabInfo.isEligible ? 'Eligible (HTTP/HTTPS)' : 'Restricted (chrome:// or internal)'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Section 5: Real-Time Audio & Speech Messages Logger */}
        <div className="pt-2">
          <AudioMessageLogger maxHeight="280px" showSimulateButton={true} />
        </div>
      </main>

      {/* Footer */}
      <footer className="pt-4 border-t border-slate-900 flex justify-between items-center text-xs text-slate-500">
        <span>Handsfree MV3 • Independent Perception Engine</span>
        <span>Models: face_landmarker.task (3.7MB) • hand_landmarker.task (7.8MB)</span>
      </footer>
    </div>
  );
};
