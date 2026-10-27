import { t } from '../settings/language';
import { Crepe, CrepeFeature } from '@milkdown/crepe';
import type { Editor } from '@milkdown/kit/core';
import { remarkStringifyOptionsCtx } from '@milkdown/kit/core';
import { installSlashMenuScroll } from './slashMenuScroll';
import { installHeadingBackspace } from './headingBackspace';
import { installQuoteBackspace } from './quoteBackspace';
import { installTableSelectAll, installTableBackspace } from './tableSelectAll';
import { $prose } from '@milkdown/kit/utils';
import { createHeadingFoldPlugin } from './headingFold';
import { preserveEmptyLines } from './preserveEmptyLines';
import { Plugin } from '@milkdown/kit/prose/state';
import type { Node as ProseNode } from '@milkdown/kit/prose/model';
import { createTableCellEditingPlugin } from './tableCellEditing';

export interface CrepeHandle {
  crepe: Crepe;
  editor: Editor;
  /** 编辑器内容变化后调用，用于把新出现的本地图片换成可显示的 URL */
  refreshImages: () => void;
  destroy: () => Promise<void>;
}

export interface CreateEditorOptions {
  root: HTMLElement;
  defaultValue: string;
  /** 把 Markdown 里的图片地址解析成可显示的 URL（只影响显示，不改变文档） */
  proxyImageUrl: (url: string) => Promise<string>;
  onChange: (markdown?: string, doc?: ProseNode) => void;
  onSelectionChange: () => void;
  onCompositionChange: (composing: boolean) => void;
  onCodeCopied?: () => void;
}

const BLOCK_MENU_LABELS = {
  textGroup: {
    label: t("文本"),
    text: { label: t("正文") },
    h1: { label: t("标题 1") },
    h2: { label: t("标题 2") },
    h3: { label: t("标题 3") },
    h4: { label: t("标题 4") },
    h5: { label: t("标题 5") },
    h6: { label: t("标题 6") },
    quote: { label: t("引用") },
    divider: { label: t("分隔线") },
  },
  listGroup: {
    label: t("列表"),
    bulletList: { label: t("无序列表") },
    orderedList: { label: t("有序列表") },
    taskList: { label: t("待办清单") },
  },
  advancedGroup: {
    label: t("插入"),
    image: { label: t("图片") },
    codeBlock: { label: t("代码块") },
    table: { label: t("表格") },
  },
};

/**
 * 序列化偏好：尽量贴近中文 Markdown 的主流写法，减少「保存后整篇 diff」。
 * 只影响符号，不影响任何语义。
 */
function preferDashedMarkers(editor: Editor): void {
  editor.config((ctx) => {
    ctx.update(remarkStringifyOptionsCtx, (prev) => ({
      ...(prev as Record<string, unknown>),
      bullet: '-',
      rule: '-',
      emphasis: '*',
      strong: '*',
      fence: '`',
      listItemIndent: 'one',
    }) as unknown as typeof prev);
  });
}

/**
 * 图片显示解析器。
 *
 * 为什么不用 Crepe 自带的 image-block：它把图片的 alt 文本改写成了缩放比例，
 * 序列化回 Markdown 时 `![说明文字](a.png)` 会变成 `![1.00](a.png)`——这是真实的数据损坏。
 *
 * 所以这里改用 CommonMark 标准的 image 节点，只在 DOM 层面把相对路径换成 data URL，
 * 文档里的地址始终保持原样。
 */
function installImageResolver(
  root: HTMLElement,
  resolve: (url: string) => Promise<string>,
): { schedule: () => void; dispose: () => void } {
  const resolved = new Map<string, string>();
  const inflight = new Set<string>();
  let raf = 0;
  let disposed = false;

  const fix = () => {
    if (disposed) return;
    const images = root.querySelectorAll<HTMLImageElement>('img');
    images.forEach((img) => {
      const raw = img.dataset.rawSrc ?? img.getAttribute('src') ?? '';
      if (!raw) return;
      img.dataset.rawSrc = raw;

      if (/^(data:|blob:|https?:|file:)/i.test(raw)) return;

      const cached = resolved.get(raw);
      if (cached) {
        if (img.getAttribute('src') !== cached) img.setAttribute('src', cached);
        return;
      }
      if (inflight.has(raw)) return;

      inflight.add(raw);
      void resolve(raw)
        .then((url) => {
          resolved.set(raw, url);
          inflight.delete(raw);
          schedule();
        })
        .catch(() => {
          inflight.delete(raw);
        });
    });
  };

  const schedule = () => {
    if (disposed) return;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(fix);
  };

  schedule();

  return {
    schedule,
    dispose: () => {
      disposed = true;
      cancelAnimationFrame(raf);
    },
  };
}

export async function createCrepeEditor(options: CreateEditorOptions): Promise<CrepeHandle> {
  const crepe = new Crepe({
    root: options.root,
    defaultValue: options.defaultValue,
    features: {
      // 关闭不必要或会破坏内容的特性
      [CrepeFeature.ImageBlock]: false, // 会改写图片 alt 文本，见上方注释
      [CrepeFeature.Toolbar]: false, // 选中气泡工具条，改用应用自身工具栏
      [CrepeFeature.TopBar]: false, // Crepe 内置工具条
      [CrepeFeature.Latex]: false, // $$ 数学公式不属于 CommonMark / GFM
      [CrepeFeature.AI]: false, // 无在线 AI
    },
    featureConfigs: {
      [CrepeFeature.Placeholder]: { text: t("输入内容，或按 “/” 插入块…") },
      // 使用原生光标，避免组合输入期间虚拟光标反复改写 contenteditable 内的 DOM。
      [CrepeFeature.Cursor]: { color: '#3370ff', width: 2, virtual: false },
      [CrepeFeature.BlockEdit]: BLOCK_MENU_LABELS,
      [CrepeFeature.CodeMirror]: {
        copyText: t("复制"),
        searchPlaceholder: t('搜索语言'),
        noResultText: t('没有匹配语言'),
        previewLabel: t('预览'),
        previewLoading: t('正在加载预览…'),
        previewToggleText: (previewOnly) => t(previewOnly ? '编辑代码' : '隐藏预览'),
        onCopy: () => options.onCodeCopied?.(),
      },
    },
  });

  crepe.addFeature(preferDashedMarkers);
  await preserveEmptyLines(crepe.editor, options.defaultValue);
  crepe.editor.use($prose(() => createHeadingFoldPlugin()));
  crepe.editor.use($prose(createTableCellEditingPlugin));
  // 组合输入结束后等 DOM 变更落入编辑器，再恢复保存和界面通知。
  crepe.editor.use($prose(() => {
    let frame = 0;
    return new Plugin({ view: (view) => {
      const start = () => {
        cancelAnimationFrame(frame);
        options.onCompositionChange(true);
      };
      const end = () => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          options.onCompositionChange(false);
          options.onChange();
        });
      };
      // 独立监听，避免其他插件接管 compositionend 后跳过本插件的恢复通知。
      view.dom.addEventListener('compositionstart', start);
      view.dom.addEventListener('compositionend', end);
      return { update() {
        // 包括 storedMarks 和撤销历史变化；只通知工具栏订阅者。
        options.onSelectionChange();
      }, destroy() {
        cancelAnimationFrame(frame);
        view.dom.removeEventListener('compositionstart', start);
        view.dom.removeEventListener('compositionend', end);
      } };
    } });
  }));
  // 必须在 create 之前挂，handleKeyDown 是建视图时读的
  installQuoteBackspace(crepe.editor);
  // 同理：表格里的 Ctrl+A 要在默认 selectAll 之前拦下来
  installTableSelectAll(crepe.editor);
  // 表格首格块首退格 = 选中整表（再退格才是删除）
  installTableBackspace(crepe.editor);

  crepe.on((listener) => {
    let updatedDoc: ProseNode | undefined;
    listener.updated((_ctx, doc) => {
      updatedDoc = doc;
    });
    listener.markdownUpdated((_ctx, markdown) => {
      options.onChange(markdown, updatedDoc);
    });
  });

  const editor = await crepe.create();

  installHeadingBackspace(editor);
  const resolver = installImageResolver(options.root, options.proxyImageUrl);
  const disposeSlashScroll = installSlashMenuScroll(options.root);

  options.onSelectionChange();

  return {
    crepe,
    editor,
    refreshImages: () => resolver.schedule(),
    destroy: async () => {
      disposeSlashScroll();
      resolver.dispose();
      await crepe.destroy();
    },
  };
}

/** 读取编辑器当前的 Markdown 序列化结果 */
export function readMarkdown(handle: CrepeHandle): string {
  return handle.crepe.getMarkdown();
}
