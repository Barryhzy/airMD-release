import { describe, expect, it } from 'vitest';
import { Schema } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import type { Transaction } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { collectHeadingSections, createHeadingFoldPlugin, headingFoldKey, toggleHeadingFold } from '../../src/core/editor/headingFold';

const schema = new Schema({ nodes: {
  doc: { content: 'block+' },
  paragraph: { group: 'block', content: 'text*' },
  heading: { group: 'block', content: 'text*', attrs: { level: { default: 1 } } },
  blockquote: { group: 'block', content: 'block+' },
  text: {},
} });
const p = (text: string) => schema.node('paragraph', null, schema.text(text));
const h = (level: number, text: string) => schema.node('heading', { level }, schema.text(text));
const document = () => schema.node('doc', null, [h(1, 'A'), p('intro'), h(3, 'B'), p('body'), h(2, 'C'), p('end'), h(1, 'D'), p('last')]);
const create = () => EditorState.create({ doc: document(), plugins: [createHeadingFoldPlugin()] });
const foldState = (state: EditorState) => headingFoldKey.getState(state)!;
function toggle(state: EditorState, pos: number): EditorState {
  let next = state;
  toggleHeadingFold({ state, dispatch: (tr: Transaction) => { next = state.applyTransaction(tr).state; } } as EditorView, pos);
  return next;
}

describe('标题章节折叠', () => {
  it('跨级标题按下一个同级/更高级标题划分范围，末节延伸到文档结尾', () => {
    const doc = document();
    const [a, b, c, d] = collectHeadingSections(doc);
    expect(a.to).toBe(d.pos);
    expect(b.to).toBe(c.pos);
    expect(c.to).toBe(d.pos);
    expect(d.to).toBe(doc.content.size);
  });

  it('引用容器内的章节不会隐藏容器外面的内容', () => {
    const quote = schema.node('blockquote', null, [h(2, 'inside'), p('body')]);
    const doc = schema.node('doc', null, [quote, p('outside')]);
    expect(collectHeadingSections(doc)[0].to).toBe(quote.nodeSize - 1);
  });

  it('折叠只更新装饰，不改变文档或制造文档事务', () => {
    const state = create();
    const next = toggle(state, 0);
    expect(next.doc.eq(state.doc)).toBe(true);
    expect(foldState(next).collapsed.has(0)).toBe(true);
    expect(foldState(next).decorations.find().some((item) => item.from === 0)).toBe(true);
    expect(toggle(next, 0).doc.toJSON()).toEqual(state.doc.toJSON());
  });

  it('先收起子节，再收起和展开父节，保留子节折叠状态', () => {
    let state = create();
    const child = foldState(state).sections[1].pos;
    state = toggle(toggle(toggle(state, child), 0), 0);
    expect([...foldState(state).collapsed]).toEqual([child]);
  });

  it('在章节前插入内容后，折叠状态跟随标题位置移动', () => {
    let state = create();
    const child = foldState(state).sections[1].pos;
    state = toggle(state, child);
    const inserted = p('new');
    state = state.applyTransaction(state.tr.insert(0, inserted)).state;
    expect(foldState(state).collapsed.has(child + inserted.nodeSize)).toBe(true);
    expect(foldState(state).collapsed.has(child)).toBe(false);
  });

  it('段中输入不替换后续标题按钮的标识', () => {
    const state = create();
    const keys = (value: EditorState) => foldState(value).decorations.find()
      .filter((item) => item.spec.key).map((item) => item.spec.key);
    const next = state.applyTransaction(state.tr.insertText('输入', 5)).state;
    expect(keys(next)).toEqual(keys(state));
  });

  it('折叠标题变成正文后，移除该折叠状态并恢复内容', () => {
    let state = toggle(create(), 0);
    state = state.applyTransaction(state.tr.setNodeMarkup(0, schema.nodes.paragraph)).state;
    expect(foldState(state).collapsed.size).toBe(0);
  });

  it('收起光标所在章节时，把光标移回标题', () => {
    let state = create();
    const section = foldState(state).sections[0];
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, section.from + 1)));
    state = toggle(state, section.pos);
    expect(state.selection.from).toBe(section.pos + 1);
    expect(foldState(state).collapsed.has(section.pos)).toBe(true);
  });

  it('大纲或键盘把选区移入折叠内容时，一次展开所有包含它的章节', () => {
    let state = create();
    const child = foldState(state).sections[1];
    state = toggle(toggle(state, child.pos), 0);
    state = state.applyTransaction(state.tr.setSelection(TextSelection.create(state.doc, child.from + 1))).state;
    expect(foldState(state).collapsed.size).toBe(0);
    expect(state.selection.from).toBe(child.from + 1);
  });

  it('标题之后没有内容时不提供空折叠', () => {
    const state = EditorState.create({ doc: schema.node('doc', null, [h(1, 'empty')]), plugins: [createHeadingFoldPlugin()] });
    expect(toggle(state, 0)).toBe(state);
    expect(foldState(state).decorations.find()).toHaveLength(0);
  });
});
