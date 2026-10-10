import { CameraController } from '../core/vision/CameraController';
import { VisionProcessor } from '../core/vision/VisionProcessor';
import { PoseUpdateMessage } from '../types/messages';

console.log('[Handsfree] Offscreen vision processor initialized.');

const camera = new CameraController(640, 480, 30);
const vision = new VisionProcessor();

async function startOffscreenLoop() {
  try {
    await vision.initialize();

    const videoEl = document.getElementById('offscreen-video') as HTMLVideoElement;
    await camera.start(videoEl);

    vision.start(videoEl, (result) => {
      // Send compact telemetry to background worker
      const message: PoseUpdateMessage = {
        type: 'POSE_UPDATE',
        telemetry: {
          pose: {
            yaw: result.yaw,
            pitch: result.pitch,
            roll: result.roll,
            confidence: result.confidence,
            faceDetected: result.faceDetected,
            timestamp: result.timestamp,
          },
          uncertaintyRadius:
            result.quality === 'OPTIMAL' ? 14 : result.quality === 'DEGRADED' ? 24 : 38,
          isTrackingStable: result.quality === 'OPTIMAL',
          trackingLost:
            vision.getTrackingMode() === 'HAND_ONLY'
              ? !result.handDetected
              : !result.handDetected && !result.faceDetected,
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
          cursorNormalizedX: result.cursorNormalizedX ?? result.activeHand?.cursorNormalizedX,
          cursorNormalizedY: result.cursorNormalizedY ?? result.activeHand?.cursorNormalizedY,
          isPinching: result.activeHand?.isPinching,
          lastFaceDetectionAgeMs: result.lastFaceDetectionTime ? Math.max(0, performance.now() - result.lastFaceDetectionTime) : undefined,
          lastHandDetectionAgeMs: result.lastHandDetectionTime ? Math.max(0, performance.now() - result.lastHandDetectionTime) : undefined,
        },
      };

      try {
        chrome.runtime.sendMessage(message).catch(() => {
          // Worker might be suspended
        });
      } catch (err) {
        // Ignored
      }
    });

    console.log('[Handsfree] Offscreen vision pipeline running.');
  } catch (err: any) {
    console.error('[Handsfree] Offscreen vision pipeline failed to start:', err);
    try {
      chrome.runtime.sendMessage({
        type: 'TRACKING_STATUS',
        isTracking: false,
        cameraActive: false,
        error: err?.message || 'Failed to acquire camera or initialize vision pipeline',
      }).catch(() => {});
    } catch {
      // Ignored
    }
  }
}

startOffscreenLoop();
