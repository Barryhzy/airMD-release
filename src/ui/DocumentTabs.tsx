import { t } from '../core/settings/language';
import { memo, useEffect, useRef, useSyncExternalStore } from 'react';
import type { DocumentTab, WorkspaceController } from '../core/doc/WorkspaceController';
import { IconClose, IconFile } from './Icons';

const Tab = memo(function Tab({ tab, active, workspace }: { tab: DocumentTab; active: boolean; workspace: WorkspaceController }) {
  const state = useSyncExternalStore(tab.controller.subscribe, tab.controller.getSnapshot, tab.controller.getSnapshot);
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!active) return;
    if (ref.current?.closest('.document-tabs')?.contains(document.activeElement)) ref.current.focus({ preventScroll: true });
    ref.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active]);
  return <div className={`document-tab${active ? ' is-active' : ''}`} onAuxClick={(event) => {
    if (event.button === 1) { event.preventDefault(); void workspace.close(tab.id); }
  }}>
    <button ref={ref} type="button" role="tab" className="document-tab__select" id={`tab-${tab.id}`}
      aria-controls={`document-${tab.id}`} aria-selected={active} tabIndex={active ? 0 : -1}
      title={state.path ?? state.title} data-testid="document-tab" data-tab-id={tab.id}
      onClick={() => void workspace.activate(tab.id)}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault();
          void workspace.cycle(event.key === 'ArrowLeft' ? -1 : 1);
        }
      }}>
      <IconFile size={14} /><span>{state.title}</span>
      {state.dirty && <span className="document-tab__dirty" aria-label={t("未保存")} />}
    </button>
    <button type="button" className="document-tab__close" title={t("关闭 {0}", { "0": state.title })} aria-label={t("关闭 {0}", { "0": state.title })}
      data-testid="close-document-tab" onClick={() => void workspace.close(tab.id)}><IconClose size={12} /></button>
  </div>;
});

export function DocumentTabs({ workspace }: { workspace: WorkspaceController }) {
  const state = useSyncExternalStore(workspace.subscribe, workspace.getSnapshot, workspace.getSnapshot);
  if (!state.tabs.length) return null;
  return <div className="document-tabs" role="tablist" aria-label={t("打开的文档")} data-testid="document-tabs">
    {state.tabs.map((tab) => <Tab key={tab.id} tab={tab} active={tab.id === state.activeId} workspace={workspace} />)}
  </div>;
}
