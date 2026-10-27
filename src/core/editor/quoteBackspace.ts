/**
 * 引用块内的空行按退格 = 离开引用。
 *
 * ProseMirror 默认把块首退格当成「并入上一块」，于是引用里的空行会直接消失、
 * 光标跳回上一行，看起来像「引用删不掉」。这里改成：空行从引用里提出来，
 * 变成一个普通段落；如果引用因此变空，引用块自己消失。
 *
 * 只接管「空段落 + 光标在块首」，其余情况（有内容、光标在中间）交回默认行为。
 */

import type { Editor } from '@milkdown/kit/core';
import { editorViewOptionsCtx } from '@milkdown/kit/core';
import type { EditorView } from '@milkdown/kit/prose/view';
import { lift } from '@milkdown/kit/prose/commands';

function liftEmptyQuoteLine(view: EditorView): boolean {
  const { state } = view;
  const { $from, empty } = state.selection;
  if (!empty || $from.parentOffset !== 0) return false;

  const block = $from.parent;
  if (!block.isTextblock || block.content.size !== 0) return false;

  let inQuote = false;
  for (let depth = $from.depth; depth > 0; depth -= 1) {
    if ($from.node(depth).type.name === 'blockquote') {
      inQuote = true;
      break;
    }
  }
  if (!inQuote) return false;

  return lift(state, view.dispatch, view);
}

/**
 * 挂在编辑器视图的 handleKeyDown 上：它比所有插件里的 keymap 都先执行，
 * 才能抢在 ProseMirror 内置的 joinBackward 之前。
 */
export function installQuoteBackspace(editor: Editor): void {
  editor.config((ctx) => {
    ctx.update(editorViewOptionsCtx, (prev) => {
      const prevKeyDown = prev.handleKeyDown;
      return {
        ...prev,
        handleKeyDown: (view, event) => {
          const plainBackspace =
            event.key === 'Backspace' &&
            !event.isComposing &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey;

          if (plainBackspace && liftEmptyQuoteLine(view)) return true;
          return prevKeyDown?.(view, event) ?? false;
        },
      };
    });
  });
}
