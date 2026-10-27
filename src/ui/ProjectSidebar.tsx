import { t } from '../core/settings/language';
import { memo, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { ProjectController } from '../core/project/ProjectController';
import { buildProjectTree, type ProjectNode } from '../core/project/tree';
import { basename } from '../core/markdown/codec';
import { IconChevronDown, IconFile, IconFolder, IconRefresh, IconSidebar, IconClose } from './Icons';

interface Props {
  controller: ProjectController;
  currentPath: string | null;
  onOpenFile: (path: string) => void;
}

export const ProjectSidebar = memo(function ProjectSidebar({ controller, currentPath, onOpenFile }: Props) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const tree = useMemo(() => buildProjectTree(state.index?.files ?? []), [state.index]);
  const matches = useMemo(() => {
    const search = query.trim().toLocaleLowerCase().replace(/\\/g, '/');
    return search ? state.index?.files.filter((file) => file.relativePath.toLocaleLowerCase().includes(search)) ?? [] : null;
  }, [state.index, query]);

  useEffect(() => { setQuery(''); setExpanded(new Set()); }, [state.root]);
  // 外部打开或搜索命中的文件自动展开父目录，已有的折叠状态仍然保留。
  useEffect(() => {
    const file = state.index?.files.find((file) => file.path === currentPath);
    if (!file) return;
    const parts = file.relativePath.split('/');
    parts.pop();
    setExpanded((previous) => {
      const next = new Set(previous);
      for (let i = 1; i <= parts.length; i++) next.add(parts.slice(0, i).join('/'));
      return next;
    });
  }, [currentPath, state.index]);

  const fileButton = (path: string, label: string, relativePath: string) => (
    <button type="button" className={`project-file${currentPath === path ? ' is-active' : ''}`}
      aria-current={currentPath === path ? 'page' : undefined} title={relativePath}
      data-testid="project-file" data-path={relativePath} onClick={() => onOpenFile(path)}>
      <IconFile size={14} /><span>{label}</span>
    </button>
  );
  const rows = (nodes: ProjectNode[]): React.ReactNode => nodes.map((node) => (
    <li key={node.relativePath}>
      {node.file ? fileButton(node.file.path, node.name, node.relativePath) : <>
        <button type="button" className="project-folder" aria-expanded={expanded.has(node.relativePath)}
          title={node.relativePath} data-testid="project-folder" data-path={node.relativePath}
          onClick={() => setExpanded((previous) => {
            const next = new Set(previous);
            if (next.has(node.relativePath)) next.delete(node.relativePath);
            else next.add(node.relativePath);
            return next;
          })}>
          <IconChevronDown size={12} /><IconFolder size={14} /><span>{node.name}</span>
        </button>
        {expanded.has(node.relativePath) && <ul>{rows(node.children)}</ul>}
      </>}
    </li>
  ));

  return <aside className="project-sidebar" data-testid="project-sidebar" hidden={!state.visible} aria-label={t("项目文件")}>
    <div className="project-sidebar__header">
      <span>{t("项目")}</span>
      <div>
        <button type="button" className="icon-btn" title={t("打开文件夹")} aria-label={t("打开文件夹")} onClick={() => void controller.openViaDialog()}><IconFolder size={14} /></button>
        <button type="button" className="icon-btn" title={t("刷新项目")} aria-label={t("刷新项目")} data-testid="project-refresh" disabled={state.loading || !state.root} onClick={() => void controller.refresh()}><IconRefresh size={14} /></button>
        <button type="button" className="icon-btn" title={t("隐藏项目")} aria-label={t("隐藏项目")} onClick={controller.toggle}><IconSidebar size={14} /></button>
        <button type="button" className="icon-btn" title={t("关闭项目")} aria-label={t("关闭项目")} data-testid="project-close" onClick={controller.close}><IconClose size={14} /></button>
      </div>
    </div>
    {state.root && <div className="project-sidebar__root" title={state.root}>{basename(state.root) || state.root}</div>}
    <input className="project-search" type="search" placeholder={t("筛选文件名或路径…")} aria-label={t("筛选项目文件")} value={query} onChange={(event) => setQuery(event.target.value)} />
    <div className="project-sidebar__summary" role="status">{state.loading ? t("正在扫描…") : t("{0} 个 Markdown 文件", { "0": state.index?.files.length ?? 0 })}</div>
    {state.error && <p className="project-sidebar__error" role="alert">{state.error}</p>}
    {Boolean(state.index?.warnings.length) && <details className="project-sidebar__warnings">
      <summary>{state.index!.warnings.length} {t(" 处无法访问，已显示其余文件")}</summary>
      {state.index!.warnings.map((warning, index) => <p key={index}>{warning}</p>)}
    </details>}
    <nav className="project-sidebar__files" aria-label={t("Markdown 文件索引")}>
      {matches ? <ul className="project-results">{matches.map((file) => <li key={file.path}>{fileButton(file.path, file.relativePath, file.relativePath)}</li>)}</ul>
        : <ul className="project-tree">{rows(tree)}</ul>}
      {!state.loading && !state.error && (matches ? matches.length === 0 : tree.length === 0) && <p className="project-sidebar__empty">{matches ? t("没有匹配的文件") : t("没有 Markdown 文件")}</p>}
    </nav>
  </aside>;
});

/** 只有这个小按钮订阅项目状态，扫描与显示切换不刷新编辑器外壳。 */
export function ProjectToggle({ controller }: { controller: ProjectController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  return <button type="button" className={`icon-btn${state.visible ? ' is-active' : ''}`} data-testid="btn-project"
    aria-label={state.visible ? t("隐藏项目") : t("显示项目")} title={state.visible ? t("隐藏项目") : t("显示项目")}
    aria-pressed={state.visible} disabled={!state.root && !state.error} onClick={controller.toggle}><IconSidebar /></button>;
}
