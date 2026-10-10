import { describe, it, expect, vi } from 'vitest';
import { ActionRewind } from '../core/recovery/ActionRewind';

describe('ActionRewind', () => {
  it('records actions and undoes the most recent in reverse chronological order', async () => {
    const rewind = new ActionRewind();

    const undo1 = vi.fn().mockReturnValue(true);
    const undo2 = vi.fn().mockReturnValue(true);

    rewind.recordAction({
      type: 'SCROLL',
      previousValue: 0,
      description: 'Scroll Down',
      undo: undo1,
    });

    rewind.recordAction({
      type: 'SCROLL',
      previousValue: 400,
      description: 'Scroll Down Again',
      undo: undo2,
    });

    expect(rewind.getCanUndo()).toBe(true);

    // Undoing should invoke undo2 first
    const res1 = await rewind.undoLastAction();
    expect(res1.success).toBe(true);
    expect(undo2).toHaveBeenCalledTimes(1);
    expect(undo1).not.toHaveBeenCalled();

    // Undoing next should invoke undo1
    const res2 = await rewind.undoLastAction();
    expect(res2.success).toBe(true);
    expect(undo1).toHaveBeenCalledTimes(1);

    // Now empty
    expect(rewind.getCanUndo()).toBe(false);
    const res3 = await rewind.undoLastAction();
    expect(res3.success).toBe(false);
  });

  it('respects maximum history stack capacity', () => {
    const rewind = new ActionRewind(3);

    for (let i = 0; i < 5; i++) {
      rewind.recordAction({
        type: 'SCROLL',
        previousValue: i,
        description: `Action ${i}`,
        undo: () => true,
      });
    }

    expect(rewind.getHistory().length).toBe(3);
  });
});
