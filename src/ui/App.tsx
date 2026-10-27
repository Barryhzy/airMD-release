import { t } from '../core/settings/language';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { type DocumentSnapshot, type UnsavedChoice } from '../core/doc/DocumentController';
import { fs, isTauri } from '../core/fs';
import { demoFileList } from '../core/fs/browserFs';
import { extname } from '../core/markdown/codec';
import {
  applyBlock,
  applyLink,
  applyMark,
  applyRedo,
  applyUndo,
  computeActiveStates,
  insertHorizontalRule,
  insertTable,
  type BlockKind,
} from '../core/editor/commands';
import { EditorToolbar } from './Toolbar';
import { Banner } from './Banner';
import { Modal } from './Modal';
import { Welcome } from './Welcome';
import { useDocFontSize } from './useDocFontSize';
import { FONT_SIZE_DEFAULT, stepFontSize } from '../core/settings/fontSize';
import { IconEye, IconFile, IconFolder, IconMoon, IconMore, IconOutline, IconSave, IconSource, IconSun } from './Icons';
import { Popover, useAnchor } from './Popover';
import { WorkspaceController } from '../core/doc/WorkspaceController';
import { DocumentTabs } from './DocumentTabs';
import { DocumentPane } from './DocumentPane';
import { ProjectController } from '../core/project/ProjectController';
import { ProjectSidebar, ProjectToggle } from './ProjectSidebar';
import { LanguageSettings } from './LanguageSettings';

type Theme = 'light' | 'dark';

function useTheme(): [Theme, () => void] {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem('airmd.theme');
    if (stored === 'light' || stored === 'dark') return stored;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('airmd.theme', theme);
  }, [theme]);

  return [theme, () => setTheme((t) => (t === 'light' ? 'dark' : 'light'))];
}

export function App() {
  const [unsavedPrompt, setUnsavedPrompt] = useState<{
    snapshot: DocumentSnapshot;
    resolve: (choice: UnsavedChoice) => void;
  } | null>(null);
  const workspace = useMemo(
    () =>
      new WorkspaceController({
        fs,
        autoSaveDelay: 900,
        watchInterval: 1500,
        confirmUnsaved: (snapshot) => new Promise((resolve) => setUnsavedPrompt({ snapshot, resolve })),
      }),
    [],
  );

  const tabs = useSyncExternalStore(workspace.subscribe, workspace.getSnapshot, workspace.getSnapshot);
  const controller = workspace.getActiveController();
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const project = useMemo(() => new ProjectController(fs, localStorage), []);

  useEffect(() => {
    void project.restore();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void project.refresh(), 300);
    };
    window.addEventListener('focus', refresh);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('focus', refresh);
      project.dispose();
    };
  }, [project]);
  const [theme, toggleTheme] = useTheme();
  const [docFontSize, setDocFontSize] = useDocFontSize();
  const [outlineVisible, setOutlineVisible] = useState(true);
  const [linkDialog, setLinkDialog] = useState<{ open: boolean; value: string }>({ open: false, value: '' });
  const [languageDialog, setLanguageDialog] = useState(false);
  const moreMenu = useAnchor();

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const getEditor = useCallback(() => controller.getEditorHandle()?.editor ?? null, [controller]);
  const hideOutline = useCallback(() => setOutlineVisible(false), []);

  /* --------------------------------------------------------- 启动引导 */

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;

    async function boot() {
      if (isTauri()) {
        const { listen } = await import('@tauri-apps/api/event');
        const { invoke } = await import('@tauri-apps/api/core');
        if (disposed) return;

        const openPendingFiles = async () => {
          const paths = await invoke<string[]>('take_initial_files');
          for (const path of paths.filter((p) => extname(p) !== '')) {
            if (disposed) return;
            await workspace.openPath(path);
          }
        };

        unlisten = await listen('open-file', () => {
          if (!disposed) void openPendingFiles();
        });
        if (disposed) {
          unlisten();
          return;
        }

        await openPendingFiles();
      } else {
        const params = new URLSearchParams(window.location.search);
        const requested = params.get('open');
        if (requested) {
          const found = demoFileList().find((f) => f.name === requested || f.path.endsWith(requested));
          if (found) await workspace.openPath(found.path);
        }
      }
    }

    void boot();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [workspace]);

  /* ------------------------------------------------------------ 快捷键 */

  useEffect(() => {
    const isMod = (e: KeyboardEvent) => (e.metaKey || e.ctrlKey) && !e.altKey && !e.isComposing;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      const key = e.key.toLowerCase();
      if (e.ctrlKey && !e.metaKey && !e.altKey && key === 'tab') {
        e.preventDefault();
        if (!unsavedPrompt && !linkDialog.open && !languageDialog) void workspace.cycle(e.shiftKey ? -1 : 1);
        return;
      }
      if (!isMod(e)) return;
      if (unsavedPrompt || linkDialog.open || languageDialog) {
        if (['s', 'o', 'n', 'e'].includes(key)) e.preventDefault();
        return;
      }

      if (key === 's') {
        e.preventDefault();
        void workspace.save(e.shiftKey);
        return;
      }
      if (key === 'o') {
        e.preventDefault();
        if (e.shiftKey) void project.openViaDialog();
        else void workspace.openViaDialog();
        return;
      }
      if (key === 'n') {
        e.preventDefault();
        void workspace.newDocument();
        return;
      }
      if (key === 'e') {
        e.preventDefault();
        void controller.setMode(state.mode === 'wysiwyg' ? 'source' : 'wysiwyg');
        return;
      }
      if (key === 'k' && state.mode === 'wysiwyg') {
        e.preventDefault();
        const editor = getEditor();
        if (!editor) return;
        const current = computeActiveStates(editor).link;
        setLinkDialog({ open: true, value: current ? 'https://' : '' });
        return;
      }
      // 字号：Ctrl/⌘ + = 放大、Ctrl/⌘ + - 缩小、Ctrl/⌘ + 0 复位
      if (key === '=' || key === '+') {
        e.preventDefault();
        setDocFontSize(stepFontSize(docFontSize, 1));
        return;
      }
      if (key === '-') {
        e.preventDefault();
        setDocFontSize(stepFontSize(docFontSize, -1));
        return;
      }
      if (key === '0') {
        e.preventDefault();
        setDocFontSize(FONT_SIZE_DEFAULT);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [controller, workspace, project, state.mode, getEditor, docFontSize, setDocFontSize, unsavedPrompt, linkDialog.open, languageDialog]);

  /* ------------------------------------------------------- 离开前保存 */

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      void workspace.flush();
      if (workspace.hasUnsavedChanges()) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    const onBlur = () => {
      void workspace.flush();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      window.removeEventListener('blur', onBlur);
    };
  }, [workspace]);

  useEffect(() => {
    if (!isTauri()) return;
    let unlisten: (() => void) | undefined;
    let disposed = false;
    let closing = false;
    void (async () => {
      const { getCurrentWindow } = await import('@tauri-apps/api/window');
      if (disposed) return;
      // Tauri 只要注册了 closeRequested 监听，就不会自己关窗口，
      // 必须由前端在合适的时候调用 destroy()。
      const appWindow = getCurrentWindow();
      unlisten = await appWindow.onCloseRequested(async (event) => {
        event.preventDefault();
        if (closing) return;
        closing = true;
        try {
          if (await workspace.prepareToClose()) await appWindow.destroy();
        } catch (error) {
          console.error(t("关闭窗口失败"), error);
        } finally {
          closing = false;
        }
      });
      if (disposed) unlisten();
    })();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [workspace]);

  /* ---------------------------------------------------------- 命令转发 */

  const runEditorCommand = useCallback(
    (fn: (editor: NonNullable<ReturnType<typeof getEditor>>) => void) => {
      const editor = getEditor();
      if (!editor) return;
      fn(editor);
    },
    [getEditor],
  );

  const handleBlock = useCallback(
    (kind: BlockKind) => runEditorCommand((editor) => applyBlock(editor, kind)),
    [runEditorCommand],
  );

  const handleMark = useCallback(
    (mark: 'strong' | 'emphasis' | 'strike_through' | 'inlineCode') =>
      runEditorCommand((editor) => applyMark(editor, mark)),
    [runEditorCommand],
  );

  const submitLink = useCallback(() => {
    const value = linkDialog.value.trim();
    setLinkDialog({ open: false, value: '' });
    runEditorCommand((editor) => applyLink(editor, value || null));
  }, [linkDialog.value, runEditorCommand]);

  const pickImage = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  /* --------------------------------------------------------------- 渲染 */

  const isReady = state.status === 'ready';
  const editing = isReady && state.mode === 'wysiwyg';

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark">a</span>
          airMD
        </div>
        <div className="header-divider" />
        <div className="doc-title">
          <span className="doc-title__name" data-testid="doc-title">
            {state.status !== 'empty' ? state.title : isTauri() ? t("未打开文档") : t("未打开文档（浏览器演示）")}
          </span>
          <span
            className={`doc-title__state${
              state.dirty ? ' doc-title__state--dirty' : state.lastSavedAt ? ' doc-title__state--saved' : ''
            }`}
            data-testid="save-state"
          >
            {state.dirty ? t("未保存") : state.lastSavedAt ? t("已保存") : ''}
          </span>
        </div>
        <div className="header-actions">
          <ProjectToggle controller={project} />
          <button type="button" className="text-btn" title={t("打开文件夹  Ctrl/⌘+Shift+O")} aria-label={t("打开文件夹")} data-testid="btn-open-folder" onClick={() => void project.openViaDialog()}>
            <IconFolder size={15} />{t("项目")}</button>
          <button
            type="button"
            className="icon-btn"
            title={t("新建  Ctrl/⌘+N")}
            aria-label={t("新建")}
            data-testid="btn-new"
            onClick={() => void workspace.newDocument()}
          >
            <IconFile />
          </button>
          <button
            type="button"
            className="icon-btn"
            title={t("打开  Ctrl/⌘+O")}
            aria-label={t("打开")}
            data-testid="btn-open"
            onClick={() => void workspace.openViaDialog()}
          >
            <IconFolder />
          </button>
          <button
            type="button"
            className="icon-btn"
            title={t("保存  Ctrl/⌘+S")}
            aria-label={t("保存")}
            data-testid="btn-save"
            disabled={!isReady}
            onClick={() => void workspace.save()}
          >
            <IconSave />
          </button>
          <div className="header-divider" />
          <button
            type="button"
            className={`icon-btn${outlineVisible ? ' is-active' : ''}`}
            title={outlineVisible ? t("隐藏大纲") : t("显示大纲")}
            aria-label={outlineVisible ? t("隐藏大纲") : t("显示大纲")}
            aria-pressed={outlineVisible}
            data-testid="btn-outline"
            disabled={!editing}
            onClick={() => setOutlineVisible((visible) => !visible)}
          >
            <IconOutline />
          </button>
          <button
            type="button"
            className={`text-btn${state.mode === 'source' ? ' is-active' : ''}`}
            title={t("切换源码模式  Ctrl/⌘+E")}
            data-testid="btn-mode"
            disabled={!isReady}
            onClick={() => void controller.setMode(state.mode === 'wysiwyg' ? 'source' : 'wysiwyg')}
          >
            {state.mode === 'source' ? <IconEye size={15} /> : <IconSource size={15} />}
            {state.mode === 'source' ? t("可视化") : t("源码")}
          </button>
          <button
            type="button"
            className="icon-btn"
            title={t("更多操作")}
            aria-label={t("更多操作")}
            aria-haspopup="menu"
            aria-expanded={moreMenu.isOpen}
            data-testid="btn-more"
            onClick={(event) => {
              if (moreMenu.isOpen) moreMenu.close();
              else moreMenu.open(event.currentTarget);
            }}
          >
            <IconMore />
          </button>
          <button
            type="button"
            className="icon-btn"
            title={theme === 'light' ? t("切换到深色") : t("切换到浅色")}
            aria-label={t("切换主题")}
            data-testid="btn-theme"
            onClick={toggleTheme}
          >
            {theme === 'light' ? <IconMoon /> : <IconSun />}
          </button>
        </div>
      </header>

      <Banner
        state={state}
        onResolveConflict={(choice) => void controller.resolveConflict(choice)}
        onAcknowledge={() => void controller.forceWysiwyg()}
        onRemember={() => void controller.rememberIntegrity()}
        onSaveAs={() => void workspace.save(true)}
        onSwitchToSource={() => void controller.setMode('source')}
      />

      <div className="workspace-layout">
        <ProjectSidebar controller={project} currentPath={state.status === 'ready' ? state.path : null} onOpenFile={workspace.openPath} />
        <main className="workspace">
          <DocumentTabs workspace={workspace} />
          <EditorToolbar
            controller={controller}
            disabled={!editing}
            docFontSize={docFontSize}
            onDocFontSize={setDocFontSize}
            onBlock={handleBlock}
            onMark={handleMark}
            onLink={() => setLinkDialog({ open: true, value: '' })}
            onInsertTable={() => runEditorCommand((editor) => insertTable(editor))}
            onInsertImage={pickImage}
            onInsertDivider={() => runEditorCommand((editor) => insertHorizontalRule(editor))}
            onUndo={() => runEditorCommand((editor) => applyUndo(editor))}
            onRedo={() => runEditorCommand((editor) => applyRedo(editor))}
          />
          {tabs.error && <div className="workspace-error" role="alert">
            <span>{tabs.error}</span><button type="button" onClick={workspace.dismissError}>{t("关闭提示")}</button>
          </div>}
          {tabs.tabs.length === 0 && <Welcome errorMessage={null} onNew={workspace.newDocument} onOpen={workspace.openViaDialog}
            nativeDialogs={fs.nativeDialogs} samples={fs.nativeDialogs ? [] : demoFileList()} onOpenSample={workspace.openPath} />}
          {tabs.tabs.map((tab) => <DocumentPane key={tab.id} tab={tab} active={tab.id === tabs.activeId}
            workspace={workspace} outlineVisible={outlineVisible} onHideOutline={hideOutline} />)}
        </main>
      </div>

      <footer className="status-bar">
        <span className="status-bar__path" title={state.path ?? ''}>
          <bdi>{state.path ?? t("未保存")}</bdi>
        </span>
        <span className="status-bar__spacer" />
        {state.meta && (
          <span className="status-bar__item" data-testid="status-encoding">
            {state.meta.encoding.toUpperCase()} · {state.meta.eol === '\r\n' ? 'CRLF' : 'LF'}
          </span>
        )}
        <span className="status-bar__item" data-testid="status-count">
          {state.wordCount} {t(" 字")}</span>
        <span className="status-bar__item">
          <span
            className={`status-bar__dot${state.dirty ? ' status-bar__dot--dirty' : ''}${
              state.status === 'error' ? ' status-bar__dot--error' : ''
            }`}
          />
          {state.saving ? t("保存中") : state.dirty ? t("有未保存改动") : state.autoSaveEnabled ? t("自动保存已开启") : t("自动保存已关闭")}
        </span>
      </footer>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        hidden
        data-testid="image-input"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = '';
          if (file) void controller.insertImageFile(file);
        }}
      />

      {moreMenu.isOpen && (
        <Popover anchor={moreMenu.rect} onClose={moreMenu.close} testId="more-menu">
          <button
            type="button"
            className="menu-item"
            disabled={!isReady}
            data-testid="menu-save-as"
            onClick={() => {
              moreMenu.close();
              void workspace.save(true);
            }}
          >
            {t("另存为…")}<span className="menu-item__hint">Ctrl/⌘+Shift+S</span>
          </button>
          <button
            type="button"
            className="menu-item"
            disabled={!state.path}
            onClick={() => {
              moreMenu.close();
              if (state.path) void fs.revealInFileManager(state.path);
            }}
          >
            {t("在文件管理器中显示")}</button>
          <div className="menu-sep" />
          <button
            type="button"
            className="menu-item"
            data-testid="menu-toggle-autosave"
            onClick={() => {
              moreMenu.close();
              controller.setAutoSave(!state.autoSaveEnabled);
            }}
          >
            {state.autoSaveEnabled ? t("关闭自动保存") : t("开启自动保存")}
          </button>
          {state.integrity?.risk === 'data-loss' && (
            <>
              <div className="menu-sep" />
              <button
                type="button"
                className="menu-item"
                data-testid="menu-restore-integrity"
                onClick={() => {
                  moreMenu.close();
                  controller.restoreIntegrity();
                }}
              >
                {t("恢复 HTML 完整性提醒")}
              </button>
            </>
          )}
          <div className="menu-sep" />
          <button type="button" className="menu-item" data-testid="menu-language" onClick={() => {
            moreMenu.close();
            setLanguageDialog(true);
          }}>{t('界面语言 / Language')}</button>
        </Popover>
      )}

      <LanguageSettings open={languageDialog} onClose={() => setLanguageDialog(false)} />

      {unsavedPrompt && (
        <Modal
          title={t("保存当前文档的改动？")}
          testId="unsaved-modal"
          onClose={() => {
            unsavedPrompt.resolve('cancel');
            setUnsavedPrompt(null);
          }}
          onSubmit={() => {
            unsavedPrompt.resolve('save');
            setUnsavedPrompt(null);
          }}
          submitLabel={t("保存并继续")}
          secondaryAction={{ label: t("不保存并继续"), onClick: () => {
            unsavedPrompt.resolve('discard');
            setUnsavedPrompt(null);
          } }}
        >
          {t('「{0}」还有未保存的改动。保存失败或取消另存为时会保留当前文档。', { '0': unsavedPrompt.snapshot.title })}</Modal>
      )}

      {linkDialog.open && (
        <Modal
          title={t("插入链接")}
          onClose={() => setLinkDialog({ open: false, value: '' })}
          onSubmit={submitLink}
          submitLabel={t("应用")}
          testId="link-modal"
        >
          <input
            className="modal__input"
            autoFocus
            placeholder="https://example.com"
            value={linkDialog.value}
            data-testid="link-input"
            onChange={(e) => setLinkDialog({ open: true, value: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submitLink();
            }}
          />
          <p style={{ margin: '10px 0 0', fontSize: 12, color: 'var(--text-tertiary)' }}>
            {t("留空并确认可移除当前链接。")}</p>
        </Modal>
      )}

      {state.notice && (
        <div className={`toast toast--${state.notice.kind}`} data-testid="toast" role="status">
          {state.notice.text}
        </div>
      )}
    </div>
  );
}
