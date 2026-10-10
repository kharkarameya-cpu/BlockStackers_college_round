/**
 * Handsfree Metrics and Benchmarking Service
 * Records privacy-preserving evaluation data and facilitates repeatable benchmark testing.
 */

import { BenchmarkMetrics } from '../../types/intent';

const STORAGE_KEY_METRICS = 'handsfree_metrics_v1';

export const DEFAULT_METRICS: BenchmarkMetrics = {
  totalTasksAttempted: 0,
  totalTasksCompleted: 0,
  taskCompletionRate: 1.0,
  averageTaskTimeMs: 0,
  unintendedActivationsPer100: 0,
  semanticAccuracyRate: 0.95,
  recoverySuccessRate: 1.0,
  averageLatencyMs: 140,
  dwellSelectionCount: 0,
  voiceCommandCount: 0,
  undoCount: 0,
};

export class MetricsService {
  /**
   * Load stored metrics from local storage
   */
  public static async getMetrics(): Promise<BenchmarkMetrics> {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try {
        const data = await chrome.storage.local.get(STORAGE_KEY_METRICS);
        return data[STORAGE_KEY_METRICS] || { ...DEFAULT_METRICS };
      } catch {
        return { ...DEFAULT_METRICS };
      }
    }
    return { ...DEFAULT_METRICS };
  }

  /**
   * Save updated metrics to local storage
   */
  public static async saveMetrics(metrics: BenchmarkMetrics): Promise<void> {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      try {
        await chrome.storage.local.set({ [STORAGE_KEY_METRICS]: metrics });
      } catch {
        // Ignored
      }
    }
  }

  /**
   * Record a completed task event
   */
  public static async recordTaskEvent(
    completed: boolean,
    durationMs: number,
    type: 'DWELL' | 'VOICE' | 'UNDO'
  ): Promise<BenchmarkMetrics> {
    const current = await MetricsService.getMetrics();

    current.totalTasksAttempted++;
    if (completed) current.totalTasksCompleted++;

    if (type === 'DWELL') current.dwellSelectionCount++;
    if (type === 'VOICE') current.voiceCommandCount++;
    if (type === 'UNDO') current.undoCount++;

    current.taskCompletionRate =
      current.totalTasksAttempted > 0
        ? current.totalTasksCompleted / current.totalTasksAttempted
        : 1.0;

    // Moving average of duration
    current.averageTaskTimeMs = Math.round(
      current.averageTaskTimeMs === 0
        ? durationMs
        : (current.averageTaskTimeMs * 0.8) + (durationMs * 0.2)
    );

    await MetricsService.saveMetrics(current);
    return current;
  }

  /**
   * Record an unintended activation (e.g. user had to immediately undo or cancelled)
   */
  public static async recordUnintendedActivation(): Promise<void> {
    const current = await MetricsService.getMetrics();
    const total = current.dwellSelectionCount + current.voiceCommandCount;
    if (total > 0) {
      current.unintendedActivationsPer100 = Math.min(
        100,
        parseFloat(((current.undoCount / total) * 100).toFixed(1))
      );
    }
    await MetricsService.saveMetrics(current);
  }

  /**
   * Reset all metrics to clean initial state
   */
  public static async resetMetrics(): Promise<void> {
    await MetricsService.saveMetrics({ ...DEFAULT_METRICS });
  }
}
