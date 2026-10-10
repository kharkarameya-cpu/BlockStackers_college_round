/**
 * Handsfree Action Rewind
 * Manages local action history for supported reversible operations.
 *
 * Supported Operations:
 * 1. Scroll restoration
 * 2. Text input reverts
 * 3. Focus restoration
 * 4. Backward navigation
 */

import { ReversibleAction } from '../../types/intent';

export class ActionRewind {
  private history: ReversibleAction[] = [];
  private readonly maxHistorySize: number;

  constructor(maxHistorySize: number = 20) {
    this.maxHistorySize = maxHistorySize;
  }

  /**
   * Push a reversible action onto the undo stack
   */
  public recordAction(action: Omit<ReversibleAction, 'id' | 'timestamp'>): void {
    const id = `act-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
    const fullAction: ReversibleAction = {
      ...action,
      id,
      timestamp: Date.now(),
    };

    this.history.unshift(fullAction);
    if (this.history.length > this.maxHistorySize) {
      this.history.pop();
    }
  }

  /**
   * Execute the most recent reversible action
   */
  public async undoLastAction(): Promise<{ success: boolean; description?: string; error?: string }> {
    if (this.history.length === 0) {
      return { success: false, error: 'No actions available to undo' };
    }

    const action = this.history.shift();
    if (!action) {
      return { success: false, error: 'Action not found' };
    }

    try {
      const result = await action.undo();
      if (result) {
        return {
          success: true,
          description: `Undid: ${action.description}`,
        };
      } else {
        return {
          success: false,
          error: `Failed to undo: target element or page state changed`,
        };
      }
    } catch (err: any) {
      return {
        success: false,
        error: err.message || 'Error executing undo operation',
      };
    }
  }

  public getCanUndo(): boolean {
    return this.history.length > 0;
  }

  public getHistory(): readonly ReversibleAction[] {
    return this.history;
  }

  public clear(): void {
    this.history = [];
  }
}
