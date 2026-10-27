import { t } from '../core/settings/language';
import { memo, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { editorViewCtx } from '@milkdown/kit/core';
import type { DocumentTab, WorkspaceController } from '../core/doc/WorkspaceController';
import { fs } from '../core/fs';
import { demoFileList } from '../core/fs/browserFs';
import { BlockHandle } from './BlockHandle';
import { TableMenu } from './TableMenu';
import { SourceEditor } from './SourceEditor';
import { Outline } from './Outline';
import { Welcome } from './Welcome';

/** 非活动标签保持挂载，保留 ProseMirror 历史、折叠、选区及两种编辑模式的滚动位置。 */
export const DocumentPane = memo(function DocumentPane({ tab, active, workspace, outlineVisible, onHideOutline }: {
  tab: DocumentTab;
  active: boolean;
  workspace: WorkspaceController;
  outlineVisible: boolean;
  onHideOutline: () => void;
}) {
  const controller = tab.controller;
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [epoch, setEpoch] = useState(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const attachCanvas = useCallback((el: HTMLDivElement | null) => controller.attachMount(el), [controller]);
  const getEditor = useCallback(() => controller.getEditorHandle()?.editor ?? null, [controller]);
  const editing = active && state.status === 'ready' && state.mode === 'wysiwyg';

  useEffect(() => {
    const timer = setTimeout(() => setEpoch((value) => value + 1), 60);
    return () => clearTimeout(timer);
  }, [state.status, state.mode, state.documentId]);
  useEffect(() => {
    if (!active || state.mode !== 'wysiwyg') return;
    if (document.activeElement?.closest('[role="tablist"]')) return;
    const frame = requestAnimationFrame(() => getEditor()?.action((ctx) => ctx.get(editorViewCtx).focus()));
    return () => cancelAnimationFrame(frame);
  }, [active, state.mode, getEditor]);

  return <section className="document-pane" id={`document-${tab.id}`} role="tabpanel" aria-labelledby={`tab-${tab.id}`}
    hidden={!active} inert={!active} data-testid="document-pane">
    {state.status === 'loading' && <div className="loading">{t("正在打开…")}</div>}
    {(state.status === 'empty' || state.status === 'error') && <Welcome
      errorMessage={state.status === 'error' ? state.errorMessage : null}
      onNew={workspace.newDocument} onOpen={workspace.openViaDialog} nativeDialogs={fs.nativeDialogs}
      samples={fs.nativeDialogs ? [] : demoFileList()} onOpenSample={workspace.openPath} />}
    {state.status === 'ready' && <>
      <div className={`editor-row${state.mode === 'source' ? ' editor-row--hidden' : ''}`}>
        <div className="editor-scroll" ref={scrollRef} data-testid="editor-scroll">
          <div className="editor-canvas" ref={attachCanvas} data-testid="editor-canvas" />
          <BlockHandle key={state.documentId} scrollRef={scrollRef} getEditor={getEditor} editorEpoch={epoch} contentVersion={state.contentVersion} disabled={!editing} />
          <TableMenu key={state.documentId} getEditor={getEditor} disabled={!editing} />
        </div>
        {state.mode === 'wysiwyg' && <Outline key={state.documentId} scrollRef={scrollRef} getEditor={getEditor}
          editorEpoch={epoch} contentVersion={state.contentVersion} disabled={!editing}
          onHide={onHideOutline} hidden={!outlineVisible} />}
      </div>
      {state.mode === 'source' && <SourceEditor active={active} value={controller.getText()}
        onChange={controller.handleSourceChange} onCompositionChange={controller.handleCompositionChange} />}
    </>}
  </section>;
});
