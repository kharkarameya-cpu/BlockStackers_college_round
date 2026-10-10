/**
 * Handsfree Dictation Controller
 * Safely inserts transcribed text into currently focused inputs, textareas, and contenteditable elements.
 */

export interface DictationResult {
  success: boolean;
  element?: HTMLElement;
  previousValue?: string;
  newValue?: string;
  error?: string;
}

export class DictationController {
  /**
   * Insert transcribed text into current active/focused element
   */
  public static insertText(text: string): DictationResult {
    if (typeof document === 'undefined') {
      return { success: false, error: 'Document unavailable' };
    }

    const activeEl = document.activeElement as HTMLElement | null;
    if (!activeEl || activeEl === document.body) {
      return { success: false, error: 'No input field currently focused' };
    }

    // 1. Standard HTML Inputs & TextAreas
    if (activeEl instanceof HTMLInputElement || activeEl instanceof HTMLTextAreaElement) {
      // Disallow non-text input types like button, submit, checkbox, radio
      const inputType = (activeEl as HTMLInputElement).type || 'text';
      if (
        ['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'image'].includes(
          inputType.toLowerCase()
        )
      ) {
        return { success: false, error: 'Target element is not a text input' };
      }

      const prevValue = activeEl.value;
      const start = activeEl.selectionStart ?? prevValue.length;
      const end = activeEl.selectionEnd ?? prevValue.length;

      // Add a space separator if appending to existing text
      const prefix = prevValue.substring(0, start);
      const suffix = prevValue.substring(end);
      const separator = prefix.length > 0 && !prefix.endsWith(' ') ? ' ' : '';
      const insertedText = separator + text;

      const nextValue = prefix + insertedText + suffix;
      activeEl.value = nextValue;

      // Restore cursor position after inserted content
      const newCursorPos = start + insertedText.length;
      activeEl.setSelectionRange(newCursorPos, newCursorPos);

      // Trigger standard React / framework event listeners
      activeEl.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));
      activeEl.dispatchEvent(new Event('change', { bubbles: true }));

      return {
        success: true,
        element: activeEl,
        previousValue: prevValue,
        newValue: nextValue,
      };
    }

    // 2. Rich Text ContentEditable elements
    if (activeEl.isContentEditable) {
      const prevHtml = activeEl.innerHTML;
      try {
        if (typeof document.execCommand === 'function') {
          document.execCommand('insertText', false, ' ' + text);
        } else {
          activeEl.textContent = (activeEl.textContent || '') + ' ' + text;
        }
        activeEl.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: text }));

        return {
          success: true,
          element: activeEl,
          previousValue: prevHtml,
          newValue: activeEl.innerHTML,
        };
      } catch (err: any) {
        return { success: false, error: err.message || 'ContentEditable insertion error' };
      }
    }

    return {
      success: false,
      error: 'Active element is not an editable field',
    };
  }

  /**
   * Programmatically focus an element for typing
   */
  public static focusElement(element: HTMLElement | null): boolean {
    if (!element) return false;
    try {
      element.focus();
      return true;
    } catch {
      return false;
    }
  }
}
