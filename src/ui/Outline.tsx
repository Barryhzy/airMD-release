import { t } from '../core/settings/language';
/**
 * 右侧常驻大纲：列出文档里的所有标题，点一下跳过去。
 *
 * 只在可视化模式显示。标题列表在「停止输入 220ms」后才重新扫，
 * 避免每敲一个字都遍历整篇文档。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { Editor } from '@milkdown/kit/core';
import { editorViewCtx } from '@milkdown/kit/core';
import { TextSelection } from '@milkdown/kit/prose/state';
import { IconChevronDown, IconOutline } from './Icons';

interface OutlineItem {
  id: string;
  level: number;
  text: string;
  pos: number;
}

interface OutlineProps {
  scrollRef: React.RefObject<HTMLDivElement | null>;
  getEditor: () => Editor | null;
  /** 编辑器实例变化时递增 */
  editorEpoch: number;
  /** 仅内容变化时递增，选区、保存状态不触发扫描。 */
  contentVersion: number;
  disabled: boolean;
  onHide: () => void;
  hidden: boolean;
}

function collectHeadings(editor: Editor | null): OutlineItem[] {
  if (!editor) return [];
  return editor.action((ctx) => {
    const { doc } = ctx.get(editorViewCtx).state;
    const items: OutlineItem[] = [];
    const occurrences = new Map<string, number>();
    doc.descendants((node, pos) => {
      if (node.type.name === 'heading') {
        const text = node.textContent.trim();
        if (text) {
          const key = `${node.attrs.level}:${text}`;
          const occurrence = occurrences.get(key) ?? 0;
          occurrences.set(key, occurrence + 1);
          items.push({ id: `${key}:${occurrence}`, level: Number(node.attrs.level), text, pos });
        }
        return false;
      }
      return true;
    });
    return items;
  });
}

export function Outline({ scrollRef, getEditor, editorEpoch, contentVersion, disabled, onHide, hidden }: OutlineProps) {
  const [items, setItems] = useState<OutlineItem[]>([]);
  const [active, setActive] = useState(-1);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const scrollScheduled = useRef(false);

  useEffect(() => setCollapsed(new Set()), [editorEpoch]);

  // 扫描标题（防抖，避免每次按键都遍历文档）
  useEffect(() => {
    if (disabled) {
      setItems([]);
      setActive(-1);
      return;
    }
    const timer = setTimeout(() => {
      setItems(collectHeadings(getEditor()));
    }, 220);
    return () => clearTimeout(timer);
  }, [disabled, editorEpoch, contentVersion, getEditor]);

  // 滚动（或标题刚扫出来）时高亮当前所在的标题
  const updateActive = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const line = scroller.getBoundingClientRect().top + 80;
    let next = -1;
    getEditor()?.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      items.forEach((item, index) => {
        const head = view.nodeDOM(item.pos);
        if (head instanceof HTMLElement && head.getClientRects().length && head.getBoundingClientRect().top <= line) next = index;
      });
    });
    setActive(next);
  }, [scrollRef, getEditor, items]);

  useEffect(() => {
    if (disabled) return;
    const raf = requestAnimationFrame(updateActive);
    return () => cancelAnimationFrame(raf);
  }, [items, disabled, updateActive]);

  useEffect(() => {
    const scroller = scrollRef.current;
    if (disabled || !scroller) return;

    const onScroll = () => {
      if (scrollScheduled.current) return;
      scrollScheduled.current = true;
      requestAnimationFrame(() => {
        scrollScheduled.current = false;
        updateActive();
      });
    };

    scroller.addEventListener('scroll', onScroll, { passive: true });
    return () => scroller.removeEventListener('scroll', onScroll);
  }, [scrollRef, disabled, editorEpoch, updateActive]);

  const jump = (item: OutlineItem) => {
    const editor = getEditor();
    if (!editor) return;
    editor.action((ctx) => {
      const view = ctx.get(editorViewCtx);
      const pos = Math.min(item.pos + 1, view.state.doc.content.size);
      const tr = view.state.tr.setSelection(TextSelection.near(view.state.doc.resolve(pos)));
      view.dispatch(tr.scrollIntoView());
      view.focus();
      // ProseMirror 的 scrollIntoView 有时不生效（滚动容器不是它认定的祖先），再补一次
      const dom = view.nodeDOM(item.pos);
      if (dom instanceof HTMLElement) dom.scrollIntoView({ block: 'start' });
    });
  };

  let hiddenBelow: number | null = null;
  const rows = items.map((item, index) => {
    if (hiddenBelow !== null && item.level > hiddenBelow) return null;
    hiddenBelow = null;
    const hasChildren = index + 1 < items.length && items[index + 1].level > item.level;
    const isCollapsed = collapsed.has(item.id);
    if (isCollapsed && hasChildren) hiddenBelow = item.level;
    return (
      <li key={item.id} className="outline__row" style={{ paddingLeft: (item.level - 1) * 10 }}>
        {hasChildren ? (
          <button
            type="button"
            className="outline__fold"
            aria-label={t("{0}子标题：{1}", { "0": isCollapsed ? t("展开") : t("收起"), "1": item.text })}
            aria-expanded={!isCollapsed}
            data-testid="outline-fold"
            onClick={() => setCollapsed((previous) => {
              const next = new Set(previous);
              if (next.has(item.id)) next.delete(item.id);
              else next.add(item.id);
              return next;
            })}
          >
            <IconChevronDown size={12} />
          </button>
        ) : <span className="outline__fold-space" />}
        <button
          type="button"
          className={`outline__item${index === active ? ' is-active' : ''}`}
          title={item.text}
          data-testid="outline-item"
          onClick={() => jump(item)}
        >
          {item.text}
        </button>
      </li>
    );
  });

  return (
    <aside className="outline" data-testid="outline" hidden={hidden}>
      <div className="outline__header">
        <div className="outline__title">{t("大纲")}</div>
        <button type="button" className="outline__hide" aria-label={t("收起大纲")} title={t("收起大纲")} onClick={onHide}>
          <IconOutline size={14} />
        </button>
      </div>
      {items.length === 0 ? (
        <div className="outline__empty">{t("还没有标题")}</div>
      ) : (
        <ul className="outline__list">
          {rows}
        </ul>
      )}
    </aside>
  );
}
