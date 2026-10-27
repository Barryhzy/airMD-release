import { t } from '../settings/language';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { Plugin, PluginKey, TextSelection } from '@milkdown/kit/prose/state';
import type { EditorState } from '@milkdown/kit/prose/state';
import { Decoration, DecorationSet } from '@milkdown/kit/prose/view';
import type { EditorView } from '@milkdown/kit/prose/view';

export interface HeadingSection {
  pos: number;
  from: number;
  to: number;
  level: number;
  text: string;
}

/** 一节止于同一容器内下一个同级/更高级标题，或容器末尾。 */
export function collectHeadingSections(doc: ProseNode): HeadingSection[] {
  const sections: HeadingSection[] = [];
  const walk = (parent: ProseNode, start: number) => {
    const open: HeadingSection[] = [];
    parent.forEach((node, offset) => {
      const pos = start + offset;
      if (node.type.name === 'heading') {
        const level = Number(node.attrs.level);
        while (open.length && open[open.length - 1].level >= level) open.pop()!.to = pos;
        const section = { pos, from: pos + node.nodeSize, to: start + parent.content.size, level, text: node.textContent };
        sections.push(section);
        open.push(section);
      } else if (!node.isLeaf && !node.isTextblock) {
        walk(node, pos + 1);
      }
    });
  };
  walk(doc, 0);
  return sections;
}

interface FoldState {
  collapsed: Set<number>;
  sections: HeadingSection[];
  decorations: DecorationSet;
}

export const headingFoldKey = new PluginKey<FoldState>('headingFold');
type FoldAction = { toggle: number } | { reveal: number[] };

function foldedSections(state: FoldState): HeadingSection[] {
  return state.sections.filter((section) => state.collapsed.has(section.pos));
}

export function toggleHeadingFold(view: EditorView, pos: number): void {
  const fold = headingFoldKey.getState(view.state);
  const section = fold?.sections.find((item) => item.pos === pos);
  if (!fold || !section || section.from === section.to) return;
  let tr = view.state.tr.setMeta(headingFoldKey, { toggle: pos }).setMeta('addToHistory', false);
  // 收起时把正在本节内的光标移回标题，避免向隐藏内容输入。
  if (!fold.collapsed.has(pos) && tr.selection.to >= section.from && tr.selection.from < section.to) {
    tr = tr.setSelection(TextSelection.near(tr.doc.resolve(pos + 1)));
  }
  view.dispatch(tr);
}

function buildDecorations(doc: ProseNode, fold: FoldState): DecorationSet {
  const hidden = foldedSections(fold);
  const isHidden = (pos: number) => hidden.some((section) => pos >= section.from && pos < section.to);
  const decorations: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (isHidden(pos)) {
      decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'heading-fold-hidden' }));
      return false;
    }
    return true;
  });
  for (const [index, section] of fold.sections.entries()) {
    if (section.from === section.to || isHidden(section.pos)) continue;
    const collapsed = fold.collapsed.has(section.pos);
    const node = doc.nodeAt(section.pos)!;
    decorations.push(Decoration.node(section.pos, section.pos + node.nodeSize, {
      class: `heading-foldable${collapsed ? ' heading-folded' : ''}`,
      'aria-label': section.text || t("未命名标题"),
    }));
    decorations.push(Decoration.widget(section.pos + 1, (view) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'heading-fold-toggle';
      button.contentEditable = 'false';
      button.dataset.testid = 'heading-fold-toggle';
      button.setAttribute('aria-expanded', String(!collapsed));
      button.setAttribute('aria-label', t("{0}章节：{1}", { "0": collapsed ? t("展开") : t("收起"), "1": section.text || t("未命名标题") }));
      button.title = collapsed ? t("展开本节") : t("收起本节");
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 16 16');
      svg.setAttribute('aria-hidden', 'true');
      const path = document.createElementNS(svg.namespaceURI, 'path');
      path.setAttribute('d', 'm5.5 3.5 4.5 4.5-4.5 4.5');
      svg.append(path);
      button.append(svg);
      button.onmousedown = (event) => event.preventDefault();
      button.onclick = () => {
        // 按钮会跨文字编辑复用，点击时从当前 DOM 取位置，不能捕获旧的 pos。
        const heading = button.parentElement;
        if (heading) toggleHeadingFold(view, view.posAtDOM(heading, 0) - 1);
      };
      return button;
    // 输入会移动后续标题的 pos；用标题序号保留按钮 DOM，避免打断输入法组合输入。
    }, { side: -1, key: `fold-${index}-${collapsed}-${section.text}`, stopEvent: () => true, ignoreSelection: true }));
  }
  return DecorationSet.create(doc, decorations);
}

function createFoldState(doc: ProseNode, collapsed: Set<number>): FoldState {
  const sections = collectHeadingSections(doc);
  const valid = new Set(sections.filter((section) => section.from < section.to).map((section) => section.pos));
  const fold: FoldState = { sections, collapsed: new Set([...collapsed].filter((pos) => valid.has(pos))), decorations: DecorationSet.empty };
  fold.decorations = buildDecorations(doc, fold);
  return fold;
}

export function createHeadingFoldPlugin(): Plugin<FoldState> {
  return new Plugin<FoldState>({
    key: headingFoldKey,
    state: {
      init: (_, state) => createFoldState(state.doc, new Set()),
      apply(tr, previous) {
        const action = tr.getMeta(headingFoldKey) as FoldAction | undefined;
        if (!tr.docChanged && !action) return previous;
        const collapsed = new Set<number>();
        for (const pos of previous.collapsed) {
          const mapped = tr.mapping.mapResult(pos, 1);
          if (!mapped.deleted && tr.doc.nodeAt(mapped.pos)?.type.name === 'heading') collapsed.add(mapped.pos);
        }
        if (action && 'toggle' in action) {
          if (collapsed.has(action.toggle)) collapsed.delete(action.toggle);
          else collapsed.add(action.toggle);
        } else if (action && 'reveal' in action) {
          for (const pos of action.reveal) collapsed.delete(pos);
        }
        return createFoldState(tr.doc, collapsed);
      },
    },
    props: { decorations: (state) => headingFoldKey.getState(state)?.decorations },
    // 大纲跳转、键盘移动、撤销等把光标移入隐藏区域时，展开对应祖先。
    appendTransaction(_, __, state: EditorState) {
      const fold = headingFoldKey.getState(state)!;
      const containing = foldedSections(fold).filter((section) =>
        state.selection.to >= section.from && state.selection.from < section.to,
      );
      if (!containing.length) return null;
      return state.tr.setMeta(headingFoldKey, { reveal: containing.map((section) => section.pos) }).setMeta('addToHistory', false);
    },
  });
}
