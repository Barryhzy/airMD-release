// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Schema } from '@milkdown/kit/prose/model';
import { EditorState, TextSelection } from '@milkdown/kit/prose/state';
import type { Editor } from '@milkdown/kit/core';
import { DocumentController } from '../../src/core/doc/DocumentController';
import { createCrepeEditor, readMarkdown, type CreateEditorOptions, type CrepeHandle } from '../../src/core/editor/createCrepe';
import type { FsAdapter } from '../../src/core/fs/types';

vi.mock('../../src/core/editor/createCrepe', () => ({
  createCrepeEditor: vi.fn(), readMarkdown: vi.fn(),
}));

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'text*', group: 'block' },
    heading: { content: 'text*', group: 'block', attrs: { level: { default: 1 } } },
    text: {},
  },
  marks: { strong: {}, emphasis: {}, strike_through: {}, inlineCode: {}, link: {} },
});
let controller: DocumentController;
let options: CreateEditorOptions;
let state: EditorState;
let markdown: string;
let written: string;
let writeGate: (() => Promise<void>) | undefined;

beforeEach(async () => {
  markdown = '';
  written = '';
  writeGate = undefined;
  state = EditorState.create({ schema });
  vi.mocked(readMarkdown).mockImplementation(() => markdown);
  vi.mocked(createCrepeEditor).mockImplementation(async (value) => {
    options = value;
    return {
      editor: { action: (fn: (ctx: unknown) => unknown) => fn({ get: () => ({ state }) }) } as unknown as Editor,
      refreshImages: vi.fn(), destroy: vi.fn(),
    } as unknown as CrepeHandle;
  });
  const fs = {
    saveDialog: async () => '/draft.md',
    stat: async () => ({ exists: false, size: 0, mtimeMs: 0, readonly: false }),
    writeFile: async (_path: string, bytes: Uint8Array) => {
      written = new TextDecoder().decode(bytes);
      await writeGate?.();
    },
  } as unknown as FsAdapter;
  controller = new DocumentController({ fs });
  controller.attachMount(document.createElement('div'));
  await controller.newDocument();
  vi.mocked(readMarkdown).mockClear();
});

afterEach(async () => {
  await controller.dispose();
});

function edit(text: string) {
  state = state.apply(state.tr.insertText(text));
  markdown = text;
}

it('reuses callback Markdown for reads, save and source mode', async () => {
  edit('latest');
  options.onChange(markdown, state.doc);
  expect(controller.getText()).toBe('latest');
  await controller.saveAs();
  expect(written).toBe('latest');
  await controller.setMode('source');
  expect(controller.getText()).toBe('latest');
  expect(readMarkdown).not.toHaveBeenCalled();
});

it('reads current content once when saving before the debounced callback', async () => {
  edit('immediate');
  await controller.saveAs();
  expect(written).toBe('immediate');
  options.onChange(markdown, state.doc);
  expect(controller.getText()).toBe('immediate');
  expect(readMarkdown).toHaveBeenCalledTimes(1);
});

it('does not use delayed Markdown belonging to an older document node', () => {
  edit('old');
  const oldDoc = state.doc;
  edit('new');
  options.onChange('old', oldDoc);
  expect(controller.getText()).toBe('new');
  expect(readMarkdown).toHaveBeenCalledTimes(1);
});

it('keeps input received during a write dirty without serializing it again', async () => {
  await controller.saveAs();
  edit('saving');
  options.onChange(markdown, state.doc);
  let release!: () => void;
  let writing!: () => void;
  const started = new Promise<void>((resolve) => { writing = resolve; });
  const pending = new Promise<void>((resolve) => { release = resolve; });
  writeGate = async () => { writing(); await pending; };
  const saved = controller.save();
  await started;
  edit('new input');
  options.onChange(markdown, state.doc);
  release();
  await saved;
  expect(written).toBe('saving');
  expect(controller.getText()).toBe('new input');
  expect(controller.getSnapshot().dirty).toBe(true);
  expect(readMarkdown).not.toHaveBeenCalled();
});

it('selection changes leave the document snapshot and content version unchanged', async () => {
  edit('text');
  options.onChange(markdown, state.doc);
  const snapshot = controller.getSnapshot();
  const notify = vi.fn();
  controller.subscribe(notify);
  for (let pos = 1; pos <= 3; pos++) {
    state = state.apply(state.tr.setSelection(TextSelection.create(state.doc, pos)));
    options.onSelectionChange();
    await new Promise(requestAnimationFrame);
  }
  expect(controller.getSnapshot()).toBe(snapshot);
  expect(notify).not.toHaveBeenCalled();
  expect(readMarkdown).not.toHaveBeenCalled();
});

it('content version changes for edits but stays stable during saving', async () => {
  const initial = controller.getSnapshot().contentVersion;
  edit('text');
  options.onChange(markdown, state.doc);
  expect(controller.getSnapshot().contentVersion).toBe(initial + 1);
  await controller.saveAs();
  expect(controller.getSnapshot().contentVersion).toBe(initial + 1);
});

it('only notifies toolbar subscribers when the active formatting changes', async () => {
  edit('text');
  options.onChange(markdown, state.doc);
  options.onSelectionChange();
  await new Promise(requestAnimationFrame);
  const notify = vi.fn();
  controller.subscribeSelection(notify);
  const snapshot = controller.getSnapshot();
  state = state.apply(state.tr.addStoredMark(schema.marks.strong.create()));
  options.onSelectionChange();
  await new Promise(requestAnimationFrame);
  expect(controller.getActiveStates().bold).toBe(true);
  expect(notify).toHaveBeenCalledTimes(1);
  options.onSelectionChange();
  await new Promise(requestAnimationFrame);
  expect(notify).toHaveBeenCalledTimes(1);
  expect(controller.getSnapshot()).toBe(snapshot);
});

it('composition cancellation keeps the original text and avoids serialization', () => {
  const original = state;
  options.onCompositionChange(true);
  edit('pinyin');
  options.onChange(markdown, state.doc);
  state = original;
  options.onCompositionChange(false);
  expect(controller.getText()).toBe('');
  expect(controller.getSnapshot().dirty).toBe(false);
  expect(readMarkdown).not.toHaveBeenCalled();
});
