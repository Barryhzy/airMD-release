/**
 * 表格命令层。
 *
 * 全部建立在 prosemirror-tables 的原生能力和 CellSelection 之上，不碰 Crepe 的
 * Vue 表格组件，这样「右键菜单 / 快捷键 / 将来的工具栏按钮」可以复用同一套实现。
 *
 * 两个容易踩的点：
 * 1. `cellAround()` 返回的是「单元格节点之前」的位置，不是单元格内容里的位置；
 * 2. `map.map[i]` 是相对表格内容起点（`$cell.start(-1)`）的偏移，不是文档绝对位置。
 */

import type { Editor } from '@milkdown/kit/core';
import { editorViewCtx } from '@milkdown/kit/core';
import type { Command, EditorState, Transaction } from '@milkdown/kit/prose/state';
import { NodeSelection, TextSelection } from '@milkdown/kit/prose/state';
import {
  CellSelection,
  TableMap,
  addColumnAfter,
  addColumnBefore,
  addRowAfter,
  addRowBefore,
  cellAround,
  deleteCellSelection,
  deleteColumn,
  deleteRow,
  deleteTable,
} from '@milkdown/kit/prose/tables';

export type TableSelectionKind = 'cell' | 'cells' | 'table';

export interface TableInfo {
  /** 选区（或光标）覆盖区域的左上角单元格，从 0 开始 */
  row: number;
  col: number;
  rows: number;
  cols: number;
  /** 当前选区跨了多少行 / 列（单格是 1×1） */
  spanRows: number;
  spanCols: number;
  selection: TableSelectionKind;
}

type Dispatch = (tr: Transaction) => void;

function run(editor: Editor, command: Command): boolean {
  let ok = false;
  editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    ok = command(view.state, view.dispatch as Dispatch, view);
    if (ok) view.focus();
  });
  return ok;
}

/** 把「选区落在表格的哪一块」翻译成菜单需要的信息 */
function describeSelection(state: EditorState): TableInfo | null {
  const { selection } = state;

  if (selection instanceof NodeSelection && selection.node.type.spec.tableRole === 'table') {
    const map = TableMap.get(selection.node);
    return {
      row: 0,
      col: 0,
      rows: map.height,
      cols: map.width,
      spanRows: map.height,
      spanCols: map.width,
      selection: 'table',
    };
  }

  const $cell = cellAround(selection.$from);
  if (!$cell) return null;

  const table = $cell.node(-1);
  const map = TableMap.get(table);
  const start = $cell.start(-1);

  let top: number;
  let bottom: number;
  let left: number;
  let right: number;
  if (selection instanceof CellSelection) {
    const a = map.findCell(selection.$anchorCell.pos - start);
    const b = map.findCell(selection.$headCell.pos - start);
    top = Math.min(a.top, b.top);
    bottom = Math.max(a.bottom, b.bottom);
    left = Math.min(a.left, b.left);
    right = Math.max(a.right, b.right);
  } else {
    const rect = map.findCell($cell.pos - start);
    top = rect.top;
    bottom = rect.bottom;
    left = rect.left;
    right = rect.right;
  }

  return {
    row: top,
    col: left,
    rows: map.height,
    cols: map.width,
    spanRows: bottom - top,
    spanCols: right - left,
    selection: selection instanceof CellSelection ? 'cells' : 'cell',
  };
}

/** 光标（或整表节点选择）所在的表格信息，供菜单决定哪些项可用 */
export function tableInfo(editor: Editor | null): TableInfo | null {
  if (!editor) return null;
  return editor.action((ctx) => describeSelection(ctx.get(editorViewCtx).state));
}

/** 当前单元格选择是否已经覆盖整张表 */
export function coversWholeTable(
  state: EditorState,
  $cell: ReturnType<typeof cellAround>,
): boolean {
  if (!$cell) return false;
  const { selection } = state;
  if (!(selection instanceof CellSelection)) return false;
  const table = $cell.node(-1);
  if (selection.$anchorCell.node(-1) !== table) return false;

  const map = TableMap.get(table);
  const start = $cell.start(-1);
  const a = map.findCell(selection.$anchorCell.pos - start);
  const b = map.findCell(selection.$headCell.pos - start);
  return (
    Math.min(a.top, b.top) === 0 &&
    Math.min(a.left, b.left) === 0 &&
    Math.max(a.bottom, b.bottom) === map.height &&
    Math.max(a.right, b.right) === map.width
  );
}

/* ------------------------------------------------------------------ 选中 */

/** 选中整张表的所有单元格（第一档） */
export function selectTableCells(editor: Editor): boolean {
  return run(editor, (state, dispatch) => {
    if (!dispatch) return true;
    const $cell = cellAround(state.selection.$from);
    if (!$cell) return false;
    const table = $cell.node(-1);
    const map = TableMap.get(table);
    const start = $cell.start(-1);
    const $first = state.doc.resolve(start + map.map[0]);
    const $last = state.doc.resolve(start + map.map[map.map.length - 1]);
    dispatch(state.tr.setSelection(new CellSelection($first, $last)));
    return true;
  });
}

/** 选中整张表（NodeSelection，退格可删除整表） */
export function selectTableNode(editor: Editor): boolean {
  return run(editor, (state, dispatch) => {
    if (!dispatch) return true;
    const $cell = cellAround(state.selection.$from);
    if (!$cell) return false;
    dispatch(state.tr.setSelection(NodeSelection.create(state.doc, $cell.before(-1))));
    return true;
  });
}

export function selectRow(editor: Editor): boolean {
  return run(editor, (state, dispatch) => {
    if (!dispatch) return true;
    const $cell = cellAround(state.selection.$from);
    if (!$cell) return false;
    dispatch(state.tr.setSelection(CellSelection.rowSelection($cell)));
    return true;
  });
}

export function selectCol(editor: Editor): boolean {
  return run(editor, (state, dispatch) => {
    if (!dispatch) return true;
    const $cell = cellAround(state.selection.$from);
    if (!$cell) return false;
    dispatch(state.tr.setSelection(CellSelection.colSelection($cell)));
    return true;
  });
}

/* ------------------------------------------------------------------ 增删 */

export function insertRowBefore(editor: Editor): boolean {
  return run(editor, addRowBefore as Command);
}

export function insertRowAfter(editor: Editor): boolean {
  return run(editor, addRowAfter as Command);
}

export function insertColBefore(editor: Editor): boolean {
  return run(editor, addColumnBefore as Command);
}

export function insertColAfter(editor: Editor): boolean {
  return run(editor, addColumnAfter as Command);
}

export function removeRow(editor: Editor): boolean {
  return run(editor, deleteRow as Command);
}

export function removeCol(editor: Editor): boolean {
  return run(editor, deleteColumn as Command);
}

export function removeTable(editor: Editor): boolean {
  return run(editor, deleteTable as Command);
}

/** 清空内容但保留行列结构 */
export function clearCells(editor: Editor): boolean {
  return run(editor, (state, dispatch) => {
    if (!dispatch) return true;

    // 多选（整行 / 整列 / 任意矩形）：直接清掉所有选中单元格
    if (state.selection instanceof CellSelection) {
      return deleteCellSelection(state, dispatch);
    }

    const $cell = cellAround(state.selection.$from);
    if (!$cell) return false;
    const cell = $cell.nodeAfter;
    if (!cell) return false;

    const paragraph = state.schema.nodes.paragraph?.create();
    const tr = state.tr.replaceWith(
      $cell.pos + 1,
      $cell.pos + 1 + cell.content.size,
      paragraph ? [paragraph] : [],
    );
    tr.setSelection(TextSelection.near(tr.doc.resolve($cell.pos + 1)));
    dispatch(tr);
    return true;
  });
}

/** 顶层块位置上的表格信息（不知道指针在哪个格子时，只用来撑起菜单表头） */
export function tableInfoOfBlock(editor: Editor | null, pos: number): TableInfo | null {
  if (!editor || pos < 0) return null;
  return editor.action((ctx) => {
    const table = ctx.get(editorViewCtx).state.doc.nodeAt(pos);
    if (!table || table.type.spec.tableRole !== 'table') return null;
    const map = TableMap.get(table);
    return {
      row: 0,
      col: 0,
      rows: map.height,
      cols: map.width,
      spanRows: 1,
      spanCols: 1,
      selection: 'table',
    };
  });
}

/** 兜底：把光标放进表格左上角单元格（不知道指针落在哪一格时用） */
export function focusFirstCell(editor: Editor, tablePos: number): TableInfo | null {
  return editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const table = view.state.doc.nodeAt(tablePos);
    if (!table || table.type.spec.tableRole !== 'table') return null;
    const map = TableMap.get(table);
    const $cell = view.state.doc.resolve(tablePos + 1 + map.map[0]);
    view.dispatch(
      view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve($cell.pos + 1))),
    );
    view.focus();
    return describeSelection(view.state);
  });
}

/** 指针位置所在的表格信息（只读，不改选区；块菜单用它显示表头） */
export function tableInfoAtPoint(
  editor: Editor | null,
  clientX: number,
  clientY: number,
): TableInfo | null {
  if (!editor) return null;
  return editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const hit = view.posAtCoords({ left: clientX, top: clientY });
    if (!hit) return null;
    const $cell = cellAround(view.state.doc.resolve(hit.pos));
    if (!$cell) return null;

    const table = $cell.node(-1);
    const map = TableMap.get(table);
    const rect = map.findCell($cell.pos - $cell.start(-1));
    return {
      row: rect.top,
      col: rect.left,
      rows: map.height,
      cols: map.width,
      spanRows: rect.bottom - rect.top,
      spanCols: rect.right - rect.left,
      selection: 'cell',
    };
  });
}

/**
 * 把选区放进某个单元格 DOM 里（块菜单用）。
 *
 * 比坐标更稳：鼠标从单元格移到左侧手柄后，client 坐标可能已经对不上，
 * 但 DOM 引用一直有效。
 */
export function focusCellElement(editor: Editor, el: HTMLElement): TableInfo | null {
  return editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    try {
      const pos = view.posAtDOM(el, 0);
      const $cell = cellAround(view.state.doc.resolve(pos));
      if (!$cell) return null;
      view.dispatch(
        view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve($cell.pos + 1))),
      );
      view.focus();
      return describeSelection(view.state);
    } catch {
      return null;
    }
  });
}

/* --------------------------------------------------------------- 右键定位 */

/**
 * 把选区落到指针下面的单元格里（右键菜单的前置动作）。
 *
 * 如果指针正好落在已有的多选范围内，保留原选区 —— 否则「选中整行」之后
 * 再右键点同一行的某个格子，会把刚刚的多选丢掉。
 */
export function focusCellAt(editor: Editor, clientX: number, clientY: number): TableInfo | null {
  return editor.action((ctx) => {
    const view = ctx.get(editorViewCtx);
    const { state } = view;
    const hit = view.posAtCoords({ left: clientX, top: clientY });
    if (!hit) return null;

    const $cell = cellAround(state.doc.resolve(hit.pos));
    if (!$cell) return null;

    const alreadySelected =
      state.selection instanceof CellSelection &&
      state.selection.ranges.some((r) => r.$from.pos <= $cell.pos && $cell.pos < r.$to.pos);

    if (!alreadySelected) {
      view.dispatch(state.tr.setSelection(TextSelection.near(state.doc.resolve($cell.pos + 1))));
    }
    view.focus();

    return describeSelection(view.state);
  });
}
