import { t } from '../core/settings/language';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import type { Editor } from '@milkdown/kit/core';
import { editorViewCtx } from '@milkdown/kit/core';
import type { BlockKind } from '../core/editor/commands';
import { BLOCK_KIND_LABEL, blockKindAt } from '../core/editor/commands';
import {
  deleteBlock,
  insertParagraphAfter,
  selectBlock,
  type BlockRef,
} from '../core/editor/blockOps';
import {
  clearCells,
  focusCellAt,
  focusCellElement,
  insertColAfter,
  insertColBefore,
  insertRowAfter,
  insertRowBefore,
  removeCol,
  removeRow,
  removeTable,
  selectCol,
  selectRow,
  selectTableNode,
  focusFirstCell,
  tableInfo,
  tableInfoAtPoint,
  tableInfoOfBlock,
  type TableInfo,
} from '../core/editor/tableCommands';
import { applyBlock } from '../core/editor/commands';
import { Popover } from './Popover';
import { IconCheck, IconDotsSix, IconPlus } from './Icons';

interface BlockHandleProps {
  scrollRef: RefObject<HTMLDivElement | null>;
  getEditor: () => Editor | null;
  /** 编辑器实例变化时递增，用于重新绑定事件 */
  editorEpoch: number;
  contentVersion: number;
  disabled: boolean;
}

interface HoverState {
  block: BlockRef;
  top: number;
  left: number;
  visible: boolean;
}

const MENU_BLOCKS: BlockKind[] = [
  'paragraph',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'quote',
  'codeBlock',
  'bulletList',
  'orderedList',
  'taskList',
];

const TEXT_KINDS: BlockKind[] = ['paragraph', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'quote', 'codeBlock'];
const LIST_KINDS: BlockKind[] = ['bulletList', 'orderedList', 'taskList'];

const HANDLE_WIDTH = 52;

/** 悬停时显示在手柄左侧的样式徽标（正文不显示，和语雀一致） */
const KIND_BADGE: Partial<Record<BlockKind, string>> = {
  h1: 'H1',
  h2: 'H2',
  h3: 'H3',
  h4: 'H4',
  h5: 'H5',
  h6: 'H6',
  quote: t("引用"),
  codeBlock: t("代码"),
  bulletList: t("无序"),
  orderedList: t("有序"),
  taskList: t("待办"),
};

export function BlockHandle({ scrollRef, getEditor, editorEpoch, contentVersion, disabled }: BlockHandleProps) {
  const [hover, setHover] = useState<HoverState | null>(null);
  const [menu, setMenu] = useState<{ anchor: DOMRect; mode: 'insert' | 'operate' } | null>(null);
  /** 块是表格时，菜单里换成表格操作；这里存指针命中的单元格信息 */
  const [tableCtx, setTableCtx] = useState<TableInfo | null>(null);
  const rafRef = useRef(0);
  const clearTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 当前手柄挂着的块：鼠标在同一块内移动时直接跳过计算 */
  const lastBlock = useRef<HTMLElement | null>(null);
  const hoverActive = useRef(false);
  /** 块在正文里的序号：块被替换（换标题/列表）后靠它找回新节点 */
  const lastIndex = useRef(-1);
  /** 块在文档里的位置：优先用它找回被重建的节点 */
  const hoverPos = useRef(-1);
  /** 上次计算时块的几何，用来判断是否真的变了 */
  const lastRect = useRef({ top: 0, left: 0, width: 0, height: 0 });
  const computeRef = useRef<((target: HTMLElement, force?: boolean) => void) | null>(null);
  const refreshRef = useRef<(() => void) | null>(null);
  /** 鼠标最后的位置：文档一变就按它重新找块，不用等 mousemove */
  const pointer = useRef<{ x: number; y: number } | null>(null);
  /** 指针最后一次落在正文里的位置（移到手柄上时不更新）：用它定位表格单元格 */
  const blockPointer = useRef<{ x: number; y: number } | null>(null);
  /** 指针最后停在哪个单元格上：表格操作按这个单元格定位，比坐标可靠 */
  const blockCell = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (disabled) {
      lastBlock.current = null;
      hoverActive.current = false;
      setHover(null);
      setMenu(null);
      return;
    }
    const container = scrollRef.current;
    if (!container) return;

    const compute = (target: HTMLElement, force = false) => {
      const editor = getEditor();
      if (!editor) return;
      const prose = container.querySelector<HTMLElement>('.ProseMirror');
      if (!prose) return;

      let node: HTMLElement | null = target;
      while (node && node.parentElement !== prose) node = node.parentElement;
      if (!node || !prose.contains(node)) return;

      // 同一块内移动：位置不会变，直接跳过 —— 避免每次 mousemove 都
      // 读一遍 rect + 走 posAtDOM + setState 触发 React 重渲染
      if (!force && node === lastBlock.current && hoverActive.current) return;

      const containerRect = container.getBoundingClientRect();
      const proseRect = prose.getBoundingClientRect();
      const blockRect = node.getBoundingClientRect();

      let pos = -1;
      let size = 0;
      try {
        editor.action((ctx) => {
          const view = ctx.get(editorViewCtx);
          pos = view.posAtDOM(node as Node, 0) - 1;
          size = pos >= 0 ? (view.state.doc.nodeAt(pos)?.nodeSize ?? 0) : 0;
          if (pos >= 0) lastIndex.current = view.state.doc.resolve(pos).index(0);
        });
      } catch {
        return;
      }
      if (pos < 0 || !size) return;

      // 标题旁给折叠箭头留出一格，操作手柄不与它重叠。
      const left = proseRect.left - containerRect.left - HANDLE_WIDTH - (/^H[1-6]$/.test(node.tagName) ? 24 : 0);

      // 手柄对齐「首行行框中心」而不是整块中心：
      // 多行段落/长代码块里，贴第一行才不会随着块变高而飘走。
      // 先拿行框（不触发样式解析），空块取不到时再用 padding + 行高推算。
      let anchorY = 0;
      let hasLine = false;
      try {
        const range = document.createRange();
        range.selectNodeContents(node);
        const firstLine = range.getClientRects()[0];
        if (firstLine && firstLine.height > 0) {
          anchorY = firstLine.top + firstLine.height / 2;
          hasLine = true;
        }
        range.detach?.();
      } catch {
        // 取不到就走下面的推算
      }

      if (!hasLine) {
        const style = window.getComputedStyle(node);
        const lineHeight = Number.parseFloat(style.lineHeight) || 0;
        const paddingTop = Number.parseFloat(style.paddingTop) || 0;
        anchorY = blockRect.top + paddingTop + (lineHeight || blockRect.height) / 2;
      }

      const top = anchorY - containerRect.top + container.scrollTop;
      lastBlock.current = node;
      hoverPos.current = pos;
      lastRect.current = { top: blockRect.top, left: blockRect.left, width: blockRect.width, height: blockRect.height };
      hoverActive.current = true;
      setHover({ block: { pos, size }, top, left, visible: left > -HANDLE_WIDTH + 4 });
    };

    computeRef.current = compute;

    /**
     * 滚动时不要收起手柄（原实现会收起）。
     * 表格、图片这类块在悬停/渲染时自己可能触发一次程序滚动，
     * 一收一放会让手柄刚出现就消失，用户根本点不到；
     * 这里改成跟着内容重新定位，块滚出可视区后会被容器裁掉。
     */
    const onScroll = () => {
      if (!hoverActive.current || !lastBlock.current) return;
      // 与鼠标命中计算分开排队，避免表格自身滚动取消刚命中的新块。
      refreshRef.current?.();
    };

    const onMouseMove = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      pointer.current = { x: event.clientX, y: event.clientY };
      if (target.closest('.block-handle')) return;
      blockPointer.current = { x: event.clientX, y: event.clientY };
      const cell = target.closest<HTMLElement>('td, th');
      if (cell) blockCell.current = cell;
      // 快速路径：还在同一个块里就不用排队算，连 rAF 都省掉
      if (hoverActive.current && lastBlock.current?.contains(target)) return;
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => compute(target));
    };

    const onLeave = () => {
      if (clearTimer.current) clearTimeout(clearTimer.current);
      clearTimer.current = setTimeout(() => {
        hoverActive.current = false;
        lastBlock.current = null;
        setHover(null);
      }, 160);
    };

    const onEnter = () => {
      if (clearTimer.current) clearTimeout(clearTimer.current);
    };

    container.addEventListener('mousemove', onMouseMove);
    container.addEventListener('mouseleave', onLeave);
    container.addEventListener('mouseenter', onEnter);
    container.addEventListener('scroll', onScroll, { passive: true });

    return () => {
      computeRef.current = null;
      cancelAnimationFrame(rafRef.current);
      if (clearTimer.current) clearTimeout(clearTimer.current);
      container.removeEventListener('mousemove', onMouseMove);
      container.removeEventListener('mouseleave', onLeave);
      container.removeEventListener('mouseenter', onEnter);
      container.removeEventListener('scroll', onScroll);
    };
  }, [scrollRef, getEditor, editorEpoch, disabled]);

  // 仅内容或实际尺寸变化时核对布局；手柄自己的 setState 不再引发测量。
  useLayoutEffect(() => {
    if (disabled) return;
    let raf = 0;
    const refresh = () => {
      cancelAnimationFrame(raf);
      if (!hoverActive.current) return;

      raf = requestAnimationFrame(() => {
        if (!hoverActive.current) return;

        const prose = scrollRef.current?.querySelector<HTMLElement>('.ProseMirror');
        if (!prose) return;

        // 文档变了（回车/转换/插入）但鼠标没动：按鼠标最后的位置重新找块，
        // 手柄始终跟着「指针下面那一个块」，而不是按回车前的那个。
        const pt = pointer.current;
        if (pt) {
          const hit = document.elementFromPoint(pt.x, pt.y) as HTMLElement | null;
          if (hit && !hit.closest('.block-handle') && prose.contains(hit)) {
            let under: HTMLElement | null = hit;
            while (under && under.parentElement !== prose) under = under.parentElement;
            if (under && under !== lastBlock.current) {
              computeRef.current?.(under, true);
              return;
            }
          }
        }

        // 优先用文档位置找回节点（换标题时节点会被重建，位置不变）
        let node: HTMLElement | null = lastBlock.current;
        if (!node?.isConnected) {
          node = null;
          const editor = getEditor();
          editor?.action((ctx) => {
            const dom = ctx.get(editorViewCtx).nodeDOM(hoverPos.current);
            if (dom instanceof HTMLElement && dom.parentElement === prose) node = dom;
          });
          // 位置也对不上时退回「块序号」兜底
          if (!node) {
            const blocks = [...prose.children].filter(
              (el) => !el.classList.contains('prosemirror-virtual-cursor'),
            );
            node = (blocks[lastIndex.current] as HTMLElement | undefined) ?? null;
          }
        }

        if (!node) {
          hoverActive.current = false;
          lastBlock.current = null;
          setHover(null);
          return;
        }

        // 几何没变就不用动。
        const rect = node.getBoundingClientRect();
        const same = Math.abs(rect.top - lastRect.current.top) < 0.5
          && Math.abs(rect.left - lastRect.current.left) < 0.5
          && Math.abs(rect.width - lastRect.current.width) < 0.5
          && Math.abs(rect.height - lastRect.current.height) < 0.5;
        if (node === lastBlock.current && same) return;

        computeRef.current?.(node, true);
      });
    };
    refreshRef.current = refresh;
    const container = scrollRef.current;
    const prose = container?.querySelector<HTMLElement>('.ProseMirror');
    // 图片加载、字号、窗口大小和章节折叠也可能改变几何，不一定改变 Markdown。
    const observer = new ResizeObserver(refresh);
    if (container) observer.observe(container);
    if (prose) observer.observe(prose);
    refresh();

    return () => {
      refreshRef.current = null;
      observer.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [scrollRef, getEditor, editorEpoch, disabled]);

  useLayoutEffect(() => {
    refreshRef.current?.();
  }, [contentVersion]);

  const editor = getEditor();

  // 悬停之后正文可能继续变化，执行操作时从当前 DOM 读取位置和长度。
  const getHoveredBlock = useCallback((): BlockRef | null => {
    const node = lastBlock.current;
    if (!node?.isConnected) return null;
    return getEditor()?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const pos = view.posAtDOM(node, 0) - 1;
      if (pos < 0 || pos >= view.state.doc.content.size) return null;
      const block = view.state.doc.nodeAt(pos);
      return block ? { pos, size: block.nodeSize } : null;
    }) ?? null;
  }, [getEditor]);

  const openMenu = useCallback(
    (mode: 'insert' | 'operate', el: HTMLElement) => {
      if (lastBlock.current?.isConnected) computeRef.current?.(lastBlock.current, true);
      setMenu({ anchor: el.getBoundingClientRect(), mode });
      if (mode !== 'operate') {
        setTableCtx(null);
        return;
      }
      // 悬停的是表格：菜单换成表格操作，并记住指针落在哪个单元格
      const isTable = Boolean(lastBlock.current?.querySelector('table'));
      const ed = getEditor();
      if (!isTable || !ed) {
        setTableCtx(null);
        return;
      }
      const pt = blockPointer.current;
      setTableCtx(
        (pt ? tableInfoAtPoint(ed, pt.x, pt.y) : null)
          ?? tableInfo(ed)
          ?? tableInfoOfBlock(ed, hoverPos.current),
      );
    },
    [getEditor],
  );

  /** 表格操作前先把选区放进指针所在单元格，再执行命令 */
  const runTableAction = useCallback(
    (tablePos: number, action: (ed: Editor) => boolean) => {
      const ed = getEditor();
      if (!ed) return;
      const cell = blockCell.current;
      const pt = blockPointer.current;
      // 优先用指针停留的那个单元格；都定位不到就退回表格左上角，别让按钮点了没反应
      const focused = cell?.isConnected
        ? focusCellElement(ed, cell)
        : pt
          ? focusCellAt(ed, pt.x, pt.y)
          : null;
      if (!focused) focusFirstCell(ed, tablePos);
      action(ed);
      setMenu(null);
    },
    [getEditor],
  );

  const handleInsert = useCallback(
    (kind: BlockKind) => {
      const block = getHoveredBlock();
      if (!editor || !block) return;
      const index = lastIndex.current;
      insertParagraphAfter(editor, block);
      applyBlock(editor, kind);
      setMenu(null);
      // 新块插在原块下方、光标也在那边，手柄要跟着过去
      requestAnimationFrame(() => {
        const prose = scrollRef.current?.querySelector<HTMLElement>('.ProseMirror');
        if (!prose) return;
        const blocks = [...prose.children].filter(
          (el) => !el.classList.contains('prosemirror-virtual-cursor'),
        );
        const next = blocks[index + 1] as HTMLElement | undefined;
        if (next) computeRef.current?.(next, true);
      });
    },
    [editor, getHoveredBlock, scrollRef],
  );

  const handleConvert = useCallback(
    (kind: BlockKind) => {
      const block = getHoveredBlock();
      if (!editor || !block) return;
      selectBlock(editor, block);
      applyBlock(editor, kind);
      setMenu(null);
    },
    [editor, getHoveredBlock],
  );

  if (disabled || !hover || !hover.visible) return null;

  // 菜单打开时读出这个块当前的类型，用来高亮「当前样式」
  const currentKind = menu?.mode === 'operate' ? blockKindAt(editor, hover.block.pos) : null;
  // 悬停时在左侧显示这行的样式（正文不显示）
  const hoverKind = blockKindAt(editor, hover.block.pos);
  const kindBadge = hoverKind ? KIND_BADGE[hoverKind] : null;

  return (
    <>
      <div
        className={`block-handle${menu ? ' is-open' : ''}`}
        style={{ top: hover.top, left: hover.left }}
        data-testid="block-handle"
      >
        {kindBadge && (
          <span className="block-handle__kind" data-testid="block-kind">
            {kindBadge}
          </span>
        )}
        <button
          type="button"
          className="block-handle__btn"
          title={t("在下方插入块")}
          aria-label={t("在下方插入块")}
          data-testid="block-add"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => openMenu('insert', e.currentTarget)}
        >
          <IconPlus size={14} />
        </button>
        <button
          type="button"
          className={`block-handle__btn${menu?.mode === 'operate' ? ' is-active' : ''}`}
          title={t("块操作")}
          aria-label={t("块操作")}
          aria-haspopup="menu"
          aria-expanded={menu?.mode === 'operate'}
          data-testid="block-ops"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => openMenu('operate', e.currentTarget)}
        >
          <IconDotsSix size={14} />
        </button>
      </div>

      {menu && menu.mode === 'insert' && (
        <Popover anchor={menu.anchor} onClose={() => setMenu(null)} testId="block-insert-menu" className="block-menu">
          <div className="menu-label">{t("在下方插入")}</div>
          <div className="menu-grid">
            {MENU_BLOCKS.map((kind) => (
              <button
                key={kind}
                type="button"
                className="menu-item"
                data-testid={`insert-${kind}`}
                onClick={() => handleInsert(kind)}
              >
                {t(BLOCK_KIND_LABEL[kind])}
              </button>
            ))}
          </div>
        </Popover>
      )}

      {menu && menu.mode === 'operate' && (
        <Popover
          anchor={menu.anchor}
          onClose={() => setMenu(null)}
          testId="block-ops-menu"
          className={`block-menu${tableCtx ? ' table-menu' : ''}`}
        >
          {tableCtx ? (
            <>
              <div className="menu-label table-menu__head" data-testid="block-table-head">
                <span>
                  {t("表格 ")}{tableCtx.rows}×{tableCtx.cols}
                </span>
                <span>
                  {t('第 {0} 行 · 第 {1} 列', { '0': tableCtx.row + 1, '1': tableCtx.col + 1 })}</span>
              </div>

              <div className="menu-label">{t("选中")}</div>
              <div className="menu-grid">
                <button
                  type="button"
                  className="menu-item"
                  data-testid="block-table-select-row"
                  onClick={() => runTableAction(hover.block.pos, selectRow)}
                >
                  {t("整行")}</button>
                <button
                  type="button"
                  className="menu-item"
                  data-testid="block-table-select-col"
                  onClick={() => runTableAction(hover.block.pos, selectCol)}
                >
                  {t("整列")}</button>
                <button
                  type="button"
                  className="menu-item"
                  data-testid="block-table-select-table"
                  onClick={() => runTableAction(hover.block.pos, selectTableNode)}
                >
                  {t("整个表格")}</button>
              </div>

              <div className="menu-sep" />
              <div className="menu-label">{t("插入")}</div>
              <div className="menu-grid">
                <button
                  type="button"
                  className="menu-item"
                  data-testid="block-table-row-before"
                  onClick={() => runTableAction(hover.block.pos, insertRowBefore)}
                >
                  {t("上方插行")}</button>
                <button
                  type="button"
                  className="menu-item"
                  data-testid="block-table-row-after"
                  onClick={() => runTableAction(hover.block.pos, insertRowAfter)}
                >
                  {t("下方插行")}</button>
                <button
                  type="button"
                  className="menu-item"
                  data-testid="block-table-col-before"
                  onClick={() => runTableAction(hover.block.pos, insertColBefore)}
                >
                  {t("左侧插列")}</button>
                <button
                  type="button"
                  className="menu-item"
                  data-testid="block-table-col-after"
                  onClick={() => runTableAction(hover.block.pos, insertColAfter)}
                >
                  {t("右侧插列")}</button>
              </div>

              <div className="menu-sep" />
              <div className="menu-label">{t("删除")}</div>
              <div className="menu-grid">
                <button
                  type="button"
                  className="menu-item"
                  data-testid="block-table-remove-row"
                  disabled={tableCtx.rows <= 1}
                  onClick={() => runTableAction(hover.block.pos, removeRow)}
                >
                  {t("删除本行")}</button>
                <button
                  type="button"
                  className="menu-item"
                  data-testid="block-table-remove-col"
                  disabled={tableCtx.cols <= 1}
                  onClick={() => runTableAction(hover.block.pos, removeCol)}
                >
                  {t("删除本列")}</button>
              </div>
              <button
                type="button"
                className="menu-item menu-item--danger"
                data-testid="block-table-remove"
                onClick={() => runTableAction(hover.block.pos, removeTable)}
              >
                {t("删除表格")}</button>

              <div className="menu-sep" />
              <button
                type="button"
                className="menu-item"
                data-testid="block-table-clear"
                onClick={() => runTableAction(hover.block.pos, clearCells)}
              >
                {t("清除内容")}<span className="menu-item__hint">{t("保留表格")}</span>
              </button>
            </>
          ) : (
            <>
              <div className="menu-label">
                {t("转换为")}{currentKind && (
                  <span className="menu-label__now" data-testid="current-kind">
                    {t("当前：")}{t(BLOCK_KIND_LABEL[currentKind])}
                  </span>
                )}
              </div>
              <div className="menu-grid">
                {TEXT_KINDS.map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    className={`menu-item${kind === currentKind ? ' is-active' : ''}`}
                    aria-current={kind === currentKind ? 'true' : undefined}
                    data-testid={`convert-${kind}`}
                    onClick={() => handleConvert(kind)}
                  >
                    {t(BLOCK_KIND_LABEL[kind])}
                    {kind === currentKind && <IconCheck size={13} className="menu-item__check" />}
                  </button>
                ))}
              </div>
              <div className="menu-sep" />
              <div className="menu-label">{t("列表")}</div>
              <div className="menu-grid">
                {LIST_KINDS.map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    className={`menu-item${kind === currentKind ? ' is-active' : ''}`}
                    aria-current={kind === currentKind ? 'true' : undefined}
                    data-testid={`convert-${kind}`}
                    onClick={() => handleConvert(kind)}
                  >
                    {t(BLOCK_KIND_LABEL[kind])}
                    {kind === currentKind && <IconCheck size={13} className="menu-item__check" />}
                  </button>
                ))}
              </div>
              <div className="menu-sep" />
              <button
                type="button"
                className="menu-item menu-item--danger"
                data-testid="block-delete"
                onClick={() => {
                  const block = getHoveredBlock();
                  if (editor && block) deleteBlock(editor, block);
                  setMenu(null);
                }}
              >
                {t("删除此块")}</button>
            </>
          )}
        </Popover>
      )}
    </>
  );
}
