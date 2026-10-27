/**
 * 表格内的 Ctrl/⌘+A 逐级全选。
 *
 * 默认的 `selectAll` 不看上下文，直接把整篇文档选中：用户在表格里想「全选这个表格」，
 * 按下 Ctrl+A 再按退格，整篇内容就没了（还会被自动保存写回磁盘）。
 *
 * 这里改成三级递进：
 *   光标所在单元格 → 整张表的全部单元格 → 表格节点 → 整篇文档（最后一步交回默认行为）。
 *
 * 挂载方式和 quoteBackspace 一样，走 `editorViewOptionsCtx.handleKeyDown`：
 * 它比所有插件里的 keymap 先执行，才能抢在默认 selectAll 之前。
 */

import type { Editor } from '@milkdown/kit/core';
import { editorViewOptionsCtx } from '@milkdown/kit/core';
import type { EditorView } from '@milkdown/kit/prose/view';
import { NodeSelection } from '@milkdown/kit/prose/state';
import { CellSelection, TableMap, cellAround } from '@milkdown/kit/prose/tables';
import { coversWholeTable } from './tableCommands';

function isSelectAll(event: KeyboardEvent): boolean {
  return (
    (event.metaKey || event.ctrlKey) &&
    !event.altKey &&
    !event.isComposing &&
    event.key.toLowerCase() === 'a'
  );
}

/** 返回 true 表示已经处理（调用方要 preventDefault） */
function escalateSelectAll(view: EditorView): boolean {
  const { state } = view;
  const { selection } = state;

  // 已经是「选中整张表」→ 交回默认，下一次 Ctrl+A 选整篇
  if (selection instanceof NodeSelection && selection.node.type.spec.tableRole === 'table') {
    return false;
  }

  const $cell = cellAround(selection.$from);
  if (!$cell) return false;

  const table = $cell.node(-1);
  const map = TableMap.get(table);
  const start = $cell.start(-1);

  // 已经选中整表单元格 → 升级成表格节点（退格即可删除整表）
  if (coversWholeTable(state, $cell)) {
    view.dispatch(state.tr.setSelection(NodeSelection.create(state.doc, start - 1)));
    return true;
  }

  // 单元格 / 部分单元格 → 选中整表单元格
  const $first = state.doc.resolve(start + map.map[0]);
  const $last = state.doc.resolve(start + map.map[map.map.length - 1]);
  view.dispatch(state.tr.setSelection(new CellSelection($first, $last)));
  return true;
}

export function installTableSelectAll(editor: Editor): void {
  editor.config((ctx) => {
    ctx.update(editorViewOptionsCtx, (prev) => {
      const prevKeyDown = prev.handleKeyDown;
      return {
        ...prev,
        handleKeyDown: (view, event) => {
          if (prevKeyDown?.(view, event)) return true;
          if (!isSelectAll(event)) return false;
          return escalateSelectAll(view);
        },
      };
    });
  });
}

/**
 * 表格第一个单元格的块首按退格 = 选中整张表。
 *
 * 默认行为在「表格是全文第一个块」时什么都不会发生（没有上一块可合并），
 * 用户很容易以为退格坏了。这里改成选中表格节点 —— 再按一次退格就是删除整表，
 * 和 ProseMirror 选中其它块级节点的习惯一致。
 */
function selectTableBackward(view: EditorView): boolean {
  const { state } = view;
  const { $from, empty } = state.selection;
  if (!empty || $from.parentOffset !== 0) return false;

  const $cell = cellAround($from);
  if (!$cell) return false;

  const table = $cell.node(-1);
  const map = TableMap.get(table);
  const tableStart = $cell.start(-1);
  // 只在表格最左上角的那个单元格生效，行中间/列中间不抢
  if ($cell.pos - tableStart !== map.map[0]) return false;

  const tablePos = tableStart - 1;
  view.dispatch(
    state.tr.setSelection(NodeSelection.create(state.doc, tablePos)).scrollIntoView(),
  );
  return true;
}

export function installTableBackspace(editor: Editor): void {
  editor.config((ctx) => {
    ctx.update(editorViewOptionsCtx, (prev) => {
      const prevKeyDown = prev.handleKeyDown;
      return {
        ...prev,
        handleKeyDown: (view, event) => {
          if (prevKeyDown?.(view, event)) return true;
          const plainBackspace =
            event.key === 'Backspace' &&
            !event.isComposing &&
            !event.ctrlKey &&
            !event.metaKey &&
            !event.altKey;
          if (!plainBackspace) return false;
          return selectTableBackward(view);
        },
      };
    });
  });
}
