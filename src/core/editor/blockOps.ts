/**
 * 针对「某个顶层块」的操作，供左侧六点菜单调用。
 * 与 commands.ts 的区别：这里的操作目标由位置显式指定，而不是当前选区。
 *
 * 注意：`duplicateBlock` / `moveBlock` / `canMove` 目前没有挂到菜单上
 * （块菜单只保留「转换为 / 列表 / 删除此块」，表格块换成表格操作）。
 * 函数保留着，将来要恢复「复制 / 上移 / 下移」直接接回 BlockHandle 即可。
 */

import type { Editor } from '@milkdown/kit/core';
import { editorViewCtx } from '@milkdown/kit/core';
import { TextSelection } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';

export interface BlockRef {
  pos: number;
  size: number;
}

function withView(editor: Editor, fn: (view: EditorView) => void): void {
  editor.action((ctx) => {
    fn(ctx.get(editorViewCtx));
  });
}

/** 把光标放进指定块的末尾 */
export function focusBlockEnd(editor: Editor, block: BlockRef): void {
  withView(editor, (view) => {
    const pos = Math.min(block.pos + block.size - 1, view.state.doc.content.size);
    view.dispatch(view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos))));
    view.focus();
  });
}

/** 选中整个块（用于让 applyBlock 作用在该块上） */
export function selectBlock(editor: Editor, block: BlockRef): void {
  withView(editor, (view) => {
    const from = Math.min(block.pos + 1, view.state.doc.content.size);
    const to = Math.min(block.pos + block.size - 1, view.state.doc.content.size);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
    view.focus();
  });
}

export function insertParagraphAfter(editor: Editor, block: BlockRef): void {
  withView(editor, (view) => {
    const paragraph = view.state.schema.nodes.paragraph;
    if (!paragraph) return;
    const at = block.pos + block.size;
    const tr = view.state.tr.insert(at, paragraph.create());
    tr.setSelection(TextSelection.near(tr.doc.resolve(at + 1)));
    view.dispatch(tr.scrollIntoView());
    view.focus();
  });
}

export function duplicateBlock(editor: Editor, block: BlockRef): void {
  withView(editor, (view) => {
    const node = view.state.doc.nodeAt(block.pos);
    if (!node) return;
    const at = block.pos + block.size;
    const tr = view.state.tr.insert(at, node.copy(node.content));
    tr.setSelection(TextSelection.near(tr.doc.resolve(at + 1)));
    view.dispatch(tr.scrollIntoView());
    view.focus();
  });
}

export function deleteBlock(editor: Editor, block: BlockRef): void {
  withView(editor, (view) => {
    if (!view.state.doc.nodeAt(block.pos)) return;
    const tr = view.state.tr.delete(block.pos, block.pos + block.size);

    // 文档要求 block+：删掉唯一的一个块时留一个空段落，否则会得到非法文档
    if (tr.doc.childCount === 0) {
      const paragraph = view.state.schema.nodes.paragraph;
      if (paragraph) tr.insert(0, paragraph.create());
    }

    const caret = Math.min(Math.max(0, block.pos - 1), tr.doc.content.size);
    tr.setSelection(TextSelection.near(tr.doc.resolve(caret)));
    view.dispatch(tr.scrollIntoView());
    view.focus();
  });
}

export function canMove(editor: Editor, block: BlockRef, direction: -1 | 1): boolean {
  return editor.action((ctx) => {
    const doc = ctx.get(editorViewCtx).state.doc;
    let found = false;
    if (direction === -1) {
      doc.forEach((child, offset) => {
        if (offset + child.nodeSize === block.pos) found = true;
      });
    } else {
      const after = block.pos + block.size;
      doc.forEach((_child, offset) => {
        if (offset === after) found = true;
      });
    }
    return found;
  });
}

export function moveBlock(editor: Editor, block: BlockRef, direction: -1 | 1): void {
  withView(editor, (view) => {
    const doc = view.state.doc;
    const node = doc.nodeAt(block.pos);
    if (!node) return;

    let siblingPos = -1;
    let siblingSize = 0;
    if (direction === -1) {
      doc.forEach((child, offset) => {
        if (offset + child.nodeSize === block.pos) {
          siblingPos = offset;
          siblingSize = child.nodeSize;
        }
      });
    } else {
      const after = block.pos + block.size;
      doc.forEach((child, offset) => {
        if (offset === after) {
          siblingPos = offset;
          siblingSize = child.nodeSize;
        }
      });
    }
    if (siblingPos < 0) return;

    const tr = view.state.tr;
    if (direction === -1) {
      tr.delete(block.pos, block.pos + block.size);
      tr.insert(siblingPos, node);
      tr.setSelection(TextSelection.near(tr.doc.resolve(siblingPos + 1)));
    } else {
      const insertAt = siblingPos + siblingSize - block.size;
      tr.delete(block.pos, block.pos + block.size);
      tr.insert(insertAt, node);
      tr.setSelection(TextSelection.near(tr.doc.resolve(insertAt + 1)));
    }
    view.dispatch(tr.scrollIntoView());
    view.focus();
  });
}
