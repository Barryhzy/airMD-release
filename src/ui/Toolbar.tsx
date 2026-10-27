import { t } from '../core/settings/language';
import { useCallback, useSyncExternalStore } from 'react';
import type { DocumentController } from '../core/doc/DocumentController';
import type { ActiveStates, BlockKind } from '../core/editor/commands';
import { BLOCK_KIND_LABEL, LIST_BLOCK_KINDS } from '../core/editor/commands';
import {
  FONT_SIZE_DEFAULT,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  FONT_SIZE_PRESETS,
  FONT_SIZE_STEP,
  formatFontSize,
  stepFontSize,
} from '../core/settings/fontSize';
import { Popover, useAnchor } from './Popover';
import {
  IconBold,
  IconBulletList,
  IconChevronDown,
  IconCode,
  IconCodeBlock,
  IconDivider,
  IconImage,
  IconItalic,
  IconLink,
  IconMinus,
  IconOrderedList,
  IconPlus,
  IconQuote,
  IconRedo,
  IconStrike,
  IconTable,
  IconTodo,
  IconUndo,
} from './Icons';

export interface ToolbarProps {
  active: ActiveStates;
  disabled: boolean;
  /** 正文字号（px），只影响阅读排版，不写进文档 */
  docFontSize: number;
  onDocFontSize: (size: number) => void;
  onBlock: (kind: BlockKind) => void;
  onMark: (mark: 'strong' | 'emphasis' | 'strike_through' | 'inlineCode') => void;
  onLink: () => void;
  onInsertTable: () => void;
  onInsertImage: () => void;
  onInsertDivider: () => void;
  onUndo: () => void;
  onRedo: () => void;
}

const BLOCK_OPTIONS: BlockKind[] = ['paragraph', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'quote', 'codeBlock'];

export function EditorToolbar({ controller, ...props }: Omit<ToolbarProps, 'active'> & { controller: DocumentController }) {
  const active = useSyncExternalStore(controller.subscribeSelection, controller.getActiveStates, controller.getActiveStates);
  return <Toolbar {...props} active={active} />;
}

export function Toolbar(props: ToolbarProps) {
  const { active, disabled } = props;
  const blockMenu = useAnchor();
  const fontMenu = useAnchor();

  const pickBlock = useCallback(
    (kind: BlockKind) => {
      blockMenu.close();
      props.onBlock(kind);
    },
    [props, blockMenu],
  );

  return (
    <div className="toolbar" role="toolbar" aria-label={t("格式工具栏")} data-testid="toolbar">
      <button
        type="button"
        className="block-select"
        disabled={disabled}
        data-testid="block-select"
        aria-haspopup="menu"
        aria-expanded={blockMenu.isOpen}
        onClick={(event) => {
          if (blockMenu.isOpen) blockMenu.close();
          else blockMenu.open(event.currentTarget);
        }}
      >
        <span>{t(BLOCK_KIND_LABEL[active.block])}</span>
        <IconChevronDown size={14} className="block-select__chevron" />
      </button>

      {/* 字号是全局阅读偏好：没有打开文档时也允许先调好 */}
      <button
        type="button"
        className={`text-btn font-btn${fontMenu.isOpen ? ' is-active' : ''}`}
        title={t("正文字号  Ctrl/⌘ + / -，Ctrl/⌘+0 复位")}
        aria-label={t("正文字号")}
        aria-haspopup="dialog"
        aria-expanded={fontMenu.isOpen}
        data-testid="btn-font-size"
        onClick={(event) => {
          if (fontMenu.isOpen) fontMenu.close();
          else fontMenu.open(event.currentTarget);
        }}
      >
        <span className="font-btn__aa">Aa</span>
        <span className="font-btn__value" data-testid="font-size-current">
          {formatFontSize(props.docFontSize)}
        </span>
      </button>

      <span className="toolbar__sep" />

      <div className="toolbar__group">
        <button
          type="button"
          className={`icon-btn${active.bold ? ' is-active' : ''}`}
          title={t("加粗  Ctrl/⌘+B")}
          aria-label={t("加粗")}
          aria-pressed={active.bold}
          disabled={disabled}
          data-testid="tb-bold"
          onClick={() => props.onMark('strong')}
        >
          <IconBold />
        </button>
        <button
          type="button"
          className={`icon-btn${active.italic ? ' is-active' : ''}`}
          title={t("斜体  Ctrl/⌘+I")}
          aria-label={t("斜体")}
          aria-pressed={active.italic}
          disabled={disabled}
          data-testid="tb-italic"
          onClick={() => props.onMark('emphasis')}
        >
          <IconItalic />
        </button>
        <button
          type="button"
          className={`icon-btn${active.strike ? ' is-active' : ''}`}
          title={t("删除线")}
          aria-label={t("删除线")}
          aria-pressed={active.strike}
          disabled={disabled}
          data-testid="tb-strike"
          onClick={() => props.onMark('strike_through')}
        >
          <IconStrike />
        </button>
        <button
          type="button"
          className={`icon-btn${active.inlineCode ? ' is-active' : ''}`}
          title={t("行内代码")}
          aria-label={t("行内代码")}
          aria-pressed={active.inlineCode}
          disabled={disabled}
          data-testid="tb-code"
          onClick={() => props.onMark('inlineCode')}
        >
          <IconCode />
        </button>
        <button
          type="button"
          className={`icon-btn${active.link ? ' is-active' : ''}`}
          title={t("链接  Ctrl/⌘+K")}
          aria-label={t("链接")}
          aria-pressed={active.link}
          disabled={disabled}
          data-testid="tb-link"
          onClick={props.onLink}
        >
          <IconLink />
        </button>
      </div>

      <span className="toolbar__sep" />

      <div className="toolbar__group">
        <button
          type="button"
          className={`icon-btn${active.block === 'bulletList' ? ' is-active' : ''}`}
          title={t("无序列表")}
          aria-label={t("无序列表")}
          disabled={disabled}
          data-testid="tb-bullet"
          onClick={() => props.onBlock('bulletList')}
        >
          <IconBulletList />
        </button>
        <button
          type="button"
          className={`icon-btn${active.block === 'orderedList' ? ' is-active' : ''}`}
          title={t("有序列表")}
          aria-label={t("有序列表")}
          disabled={disabled}
          data-testid="tb-ordered"
          onClick={() => props.onBlock('orderedList')}
        >
          <IconOrderedList />
        </button>
        <button
          type="button"
          className={`icon-btn${active.block === 'taskList' ? ' is-active' : ''}`}
          title={t("待办清单")}
          aria-label={t("待办清单")}
          disabled={disabled}
          data-testid="tb-todo"
          onClick={() => props.onBlock('taskList')}
        >
          <IconTodo />
        </button>
        <button
          type="button"
          className={`icon-btn${active.block === 'quote' ? ' is-active' : ''}`}
          title={t("引用")}
          aria-label={t("引用")}
          disabled={disabled}
          data-testid="tb-quote"
          onClick={() => props.onBlock('quote')}
        >
          <IconQuote />
        </button>
        <button
          type="button"
          className={`icon-btn${active.block === 'codeBlock' ? ' is-active' : ''}`}
          title={t("代码块")}
          aria-label={t("代码块")}
          disabled={disabled}
          data-testid="tb-codeblock"
          onClick={() => props.onBlock('codeBlock')}
        >
          <IconCodeBlock />
        </button>
        <button
          type="button"
          className="icon-btn"
          title={t("表格")}
          aria-label={t("插入表格")}
          disabled={disabled}
          data-testid="tb-table"
          onClick={props.onInsertTable}
        >
          <IconTable />
        </button>
        <button
          type="button"
          className="icon-btn"
          title={t("图片")}
          aria-label={t("插入图片")}
          disabled={disabled}
          data-testid="tb-image"
          onClick={props.onInsertImage}
        >
          <IconImage />
        </button>
        <button
          type="button"
          className="icon-btn"
          title={t("分隔线")}
          aria-label={t("插入分隔线")}
          disabled={disabled}
          data-testid="tb-divider"
          onClick={props.onInsertDivider}
        >
          <IconDivider />
        </button>
      </div>

      <span className="toolbar__spacer" />

      <div className="toolbar__group">
        <button
          type="button"
          className="icon-btn"
          title={t("撤销  Ctrl/⌘+Z")}
          aria-label={t("撤销")}
          disabled={disabled || !active.canUndo}
          data-testid="tb-undo"
          onClick={props.onUndo}
        >
          <IconUndo />
        </button>
        <button
          type="button"
          className="icon-btn"
          title={t("重做  Ctrl/⌘+Shift+Z")}
          aria-label={t("重做")}
          disabled={disabled || !active.canRedo}
          data-testid="tb-redo"
          onClick={props.onRedo}
        >
          <IconRedo />
        </button>
      </div>

      {fontMenu.isOpen && (
        <Popover
          anchor={fontMenu.rect}
          onClose={fontMenu.close}
          role="dialog"
          testId="font-panel"
        >
          <div className="font-panel">
            <div className="font-panel__head">
              <span className="font-panel__title">{t("正文字号")}</span>
              <span className="font-panel__value" data-testid="font-size-value">
                {formatFontSize(props.docFontSize)} px
              </span>
            </div>

            <div className="font-panel__row">
              <button
                type="button"
                className="font-panel__step"
                aria-label={t("减小字号")}
                data-testid="font-size-dec"
                disabled={props.docFontSize <= FONT_SIZE_MIN}
                onClick={() => props.onDocFontSize(stepFontSize(props.docFontSize, -1))}
              >
                <IconMinus size={14} />
              </button>
              <input
                type="range"
                className="font-panel__slider"
                min={FONT_SIZE_MIN}
                max={FONT_SIZE_MAX}
                step={FONT_SIZE_STEP}
                value={props.docFontSize}
                aria-label={t("正文字号")}
                data-testid="font-size-slider"
                onChange={(event) => props.onDocFontSize(Number(event.target.value))}
              />
              <button
                type="button"
                className="font-panel__step"
                aria-label={t("增大字号")}
                data-testid="font-size-inc"
                disabled={props.docFontSize >= FONT_SIZE_MAX}
                onClick={() => props.onDocFontSize(stepFontSize(props.docFontSize, 1))}
              >
                <IconPlus size={14} />
              </button>
            </div>

            <div className="font-panel__presets">
              {FONT_SIZE_PRESETS.map((preset) => (
                <button
                  key={preset.size}
                  type="button"
                  className={`font-panel__preset${
                    preset.size === props.docFontSize ? ' is-active' : ''
                  }`}
                  aria-pressed={preset.size === props.docFontSize}
                  data-testid={`font-preset-${preset.size}`}
                  onClick={() => props.onDocFontSize(preset.size)}
                >
                  {t(preset.label)}
                </button>
              ))}
            </div>

            <div className="menu-sep" />
            <button
              type="button"
              className="menu-item"
              data-testid="font-size-reset"
              disabled={props.docFontSize === FONT_SIZE_DEFAULT}
              onClick={() => props.onDocFontSize(FONT_SIZE_DEFAULT)}
            >
              {t("恢复默认字号")}<span className="menu-item__hint">{formatFontSize(FONT_SIZE_DEFAULT)} px</span>
            </button>
          </div>
        </Popover>
      )}

      {blockMenu.isOpen && (
        <Popover anchor={blockMenu.rect} onClose={blockMenu.close} testId="block-menu">
          {BLOCK_OPTIONS.map((kind) => (
            <button
              key={kind}
              type="button"
              className={`menu-item${active.block === kind ? ' is-active' : ''}`}
              data-testid={`block-option-${kind}`}
              onClick={() => pickBlock(kind)}
            >
              {t(BLOCK_KIND_LABEL[kind])}
              {active.block === kind && <span className="menu-item__hint">{t("当前")}</span>}
            </button>
          ))}
          <div className="menu-sep" />
          <div className="menu-label">{t("列表")}</div>
          {LIST_BLOCK_KINDS.map((kind) => (
            <button
              key={kind}
              type="button"
              className={`menu-item${active.block === kind ? ' is-active' : ''}`}
              data-testid={`block-option-${kind}`}
              onClick={() => pickBlock(kind)}
            >
              {t(BLOCK_KIND_LABEL[kind])}
            </button>
          ))}
        </Popover>
      )}
    </div>
  );
}
