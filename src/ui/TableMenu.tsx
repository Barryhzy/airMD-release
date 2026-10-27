import { t } from '../core/settings/language';
/**
 * 表格右键菜单。
 *
 * 表格是「结构」而不是「文字」：想删一行、插一列、清空一块，靠光标和退格很难表达。
 * 这里在单元格上右键给出全部结构操作，同时补上 Crepe 没有的入口：
 * 选中整行 / 整列 / 整个表格（选中之后按退格是删除，按 Delete 是清内容）。
 *
 * 菜单本身只是壳，所有动作都在 core/editor/tableCommands.ts 里，便于单测和复用。
 */

import { useCallback, useEffect, useState } from 'react';
import type { Editor } from '@milkdown/kit/core';
import { editorViewCtx } from '@milkdown/kit/core';
import {
  clearCells,
  focusCellAt,
  insertColAfter,
  insertColBefore,
  insertRowAfter,
  insertRowBefore,
  removeCol,
  removeRow,
  removeTable,
  selectCol,
  selectRow,
  selectTableCells,
  selectTableNode,
  tableInfo,
  type TableInfo,
} from '../core/editor/tableCommands';
import { Popover } from './Popover';

interface TableMenuProps {
  getEditor: () => Editor | null;
  disabled: boolean;
}

interface MenuState {
  anchor: DOMRect;
  info: TableInfo;
}

export function TableMenu({ getEditor, disabled }: TableMenuProps) {
  const [menu, setMenu] = useState<MenuState | null>(null);

  useEffect(() => {
    if (disabled) { setMenu(null); return; }

    const onContextMenu = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest) return;
      // 只接管表格单元格上的右键，其它地方保留浏览器默认菜单
      if (!target.closest('.ProseMirror td, .ProseMirror th')) return;

      const editor = getEditor();
      if (!editor) return;
      if (!editor.action((ctx) => ctx.get(editorViewCtx).dom.contains(target))) return;

      event.preventDefault();
      const info = focusCellAt(editor, event.clientX, event.clientY);
      if (!info) return;
      setMenu({ anchor: new DOMRect(event.clientX, event.clientY, 0, 0), info });
    };

    document.addEventListener('contextmenu', onContextMenu);
    return () => document.removeEventListener('contextmenu', onContextMenu);
  }, [disabled, getEditor]);

  // 滚动 / 改窗口大小时菜单位置会漂，直接关掉。
  // 但「刚打开的那一下」要放过：设选区时浏览器可能把单元格滚进视野，
  // 这不是用户滚动，否则菜单会刚出现就被自己关掉。
  useEffect(() => {
    if (!menu) return;
    const openedAt = performance.now();
    const close = () => setMenu(null);
    const onScroll = () => {
      if (performance.now() - openedAt < 250) return;
      close();
    };
    const scroller = getEditor()?.action((ctx) => ctx.get(editorViewCtx).dom.closest('.editor-scroll'));
    window.addEventListener('resize', close);
    scroller?.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('resize', close);
      scroller?.removeEventListener('scroll', onScroll);
    };
  }, [menu, getEditor]);

  const close = useCallback(() => setMenu(null), []);

  /** 结构操作：执行后关闭菜单 */
  const act = useCallback(
    (fn: (editor: Editor) => boolean) => {
      const editor = getEditor();
      if (!editor) return;
      fn(editor);
      setMenu(null);
    },
    [getEditor],
  );

  /** 选中类操作：执行后菜单留着，方便紧接着点「删除本行 / 清除内容」 */
  const select = useCallback(
    (fn: (editor: Editor) => boolean) => {
      const editor = getEditor();
      if (!editor) return;
      fn(editor);
      const info = tableInfo(editor);
      if (info) setMenu((prev) => (prev ? { ...prev, info } : prev));
    },
    [getEditor],
  );

  if (!menu) return null;
  const { info } = menu;
  const onlyRow = info.rows <= 1;
  const onlyCol = info.cols <= 1;

  return (
    <Popover
      anchor={menu.anchor}
      onClose={close}
      role="menu"
      testId="table-menu"
      className="table-menu"
    >
      <div className="menu-label table-menu__head" data-testid="table-menu-head">
        <span>
          {t("表格 ")}{info.rows}×{info.cols}
        </span>
        <span data-testid="table-menu-pos">
          {info.selection !== 'cell' && (info.spanRows > 1 || info.spanCols > 1)
            ? t("已选 {0} 行 × {1} 列", { "0": info.spanRows, "1": info.spanCols })
            : t("第 {0} 行 · 第 {1} 列", { "0": info.row + 1, "1": info.col + 1 })}
        </span>
      </div>

      <div className="menu-label">{t("选中")}</div>
      <div className="menu-grid">
        <button
          type="button"
          className="menu-item"
          data-testid="table-menu-select-row"
          onClick={() => select(selectRow)}
        >
          {t("整行")}</button>
        <button
          type="button"
          className="menu-item"
          data-testid="table-menu-select-col"
          onClick={() => select(selectCol)}
        >
          {t("整列")}</button>
        <button
          type="button"
          className="menu-item"
          data-testid="table-menu-select-cells"
          onClick={() => select(selectTableCells)}
        >
          {t("全部单元格")}</button>
        <button
          type="button"
          className="menu-item"
          data-testid="table-menu-select-table"
          onClick={() => select(selectTableNode)}
        >
          {t("整个表格")}</button>
      </div>

      <div className="menu-sep" />
      <div className="menu-label">{t("插入")}</div>
      <div className="menu-grid">
        <button
          type="button"
          className="menu-item"
          data-testid="table-menu-row-before"
          onClick={() => act(insertRowBefore)}
        >
          {t("上方插行")}</button>
        <button
          type="button"
          className="menu-item"
          data-testid="table-menu-row-after"
          onClick={() => act(insertRowAfter)}
        >
          {t("下方插行")}</button>
        <button
          type="button"
          className="menu-item"
          data-testid="table-menu-col-before"
          onClick={() => act(insertColBefore)}
        >
          {t("左侧插列")}</button>
        <button
          type="button"
          className="menu-item"
          data-testid="table-menu-col-after"
          onClick={() => act(insertColAfter)}
        >
          {t("右侧插列")}</button>
      </div>

      <div className="menu-sep" />
      <div className="menu-label">{t("删除")}</div>
      <button
        type="button"
        className="menu-item"
        data-testid="table-menu-remove-row"
        disabled={onlyRow}
        onClick={() => act(removeRow)}
      >
        {t("删除本行")}{onlyRow && <span className="menu-item__hint">{t("仅剩一行")}</span>}
      </button>
      <button
        type="button"
        className="menu-item"
        data-testid="table-menu-remove-col"
        disabled={onlyCol}
        onClick={() => act(removeCol)}
      >
        {t("删除本列")}{onlyCol && <span className="menu-item__hint">{t("仅剩一列")}</span>}
      </button>
      <button
        type="button"
        className="menu-item menu-item--danger"
        data-testid="table-menu-remove-table"
        onClick={() => act(removeTable)}
      >
        {t("删除表格")}</button>

      <div className="menu-sep" />
      <button
        type="button"
        className="menu-item"
        data-testid="table-menu-clear"
        onClick={() => act(clearCells)}
      >
        {t("清除内容")}<span className="menu-item__hint">{t("保留表格")}</span>
      </button>
    </Popover>
  );
}
