import { t } from '../core/settings/language';
import type { DocumentSnapshot } from '../core/doc/DocumentController';
import { isSafeForDirectWrite } from '../core/markdown/codec';
import { IconWarning } from './Icons';

interface BannerProps {
  state: DocumentSnapshot;
  onResolveConflict: (choice: 'reload' | 'overwrite' | 'save-as') => void;
  onAcknowledge: () => void;
  onRemember: () => void;
  onSaveAs: () => void;
  onSwitchToSource: () => void;
}

function Frame({
  tone,
  title,
  children,
  actions,
  testId,
}: {
  tone: 'warn' | 'error' | 'info';
  title: string;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  testId: string;
}) {
  return (
    <div className={`banner banner--${tone}`} data-testid={testId} role="alert">
      <span className="banner__icon">
        <IconWarning size={15} />
      </span>
      <div className="banner__body">
        <div className="banner__title">{title}</div>
        {children}
        {actions && <div className="banner__actions">{actions}</div>}
      </div>
    </div>
  );
}

export function Banner({
  state,
  onResolveConflict,
  onAcknowledge,
  onRemember,
  onSaveAs,
  onSwitchToSource,
}: BannerProps) {
  if (state.status === 'error' && state.errorMessage) {
    return (
      <Frame tone="error" title={t("打开失败")} testId="banner-error">
        {state.errorMessage}
      </Frame>
    );
  }

  if (state.conflict) {
    return (
      <Frame
        tone="error"
        title={t("文件已被其它程序修改")}
        testId="banner-conflict"
        actions={
          <>
            <button type="button" className="banner__btn banner__btn--primary" onClick={() => onResolveConflict('reload')}>
              {t("重新载入磁盘内容")}</button>
            <button type="button" className="banner__btn" onClick={() => onResolveConflict('overwrite')}>
              {t("用我的内容覆盖")}</button>
            <button type="button" className="banner__btn" onClick={() => onResolveConflict('save-as')}>
              {t("另存为…")}</button>
          </>
        }
      >
        {t("为避免覆盖其它程序的改动，自动保存已暂停。请选择如何处理。")}</Frame>
    );
  }

  const unsupported = state.integrity && state.integrity.risk === 'data-loss' && !state.integrityAcknowledged;

  if (unsupported && state.integrity) {
    return (
      <Frame
        tone="warn"
        title={t("已用源码模式打开以保护内容")}
        testId="banner-integrity"
        actions={
          <>
            <button
              type="button"
              className="banner__btn banner__btn--primary"
              data-testid="banner-remember"
              title={t("之后打开任何 Markdown 都直接进可视化，不再提醒；原始 HTML 仍然会被丢掉。可在「更多」菜单里恢复")}
              onClick={onRemember}
            >
              {t("不再提示（所有 Markdown）")}</button>
            <button type="button" className="banner__btn" onClick={onAcknowledge}>
              {t("仍要可视化编辑")}</button>
            <button type="button" className="banner__btn" onClick={onSaveAs}>
              {t("另存为新的 Markdown")}</button>
          </>
        }
      >
        {state.integrity.notes.join(' ')}
        <br />
        {t("在源码模式下编辑不会丢失任何字符，自动保存照常工作。")}</Frame>
    );
  }

  if (state.meta && !isSafeForDirectWrite(state.meta.encoding)) {
    return (
      <Frame
        tone="warn"
        title={t("文件编码不是 UTF-8")}
        testId="banner-encoding"
        actions={
          <>
            <button type="button" className="banner__btn banner__btn--primary" onClick={onSaveAs}>
              {t("另存为 UTF-8")}</button>
            {state.mode === 'wysiwyg' && (
              <button type="button" className="banner__btn" onClick={onSwitchToSource}>
                {t("切到源码模式")}</button>
            )}
          </>
        }
      >
        {t('当前编码为 {0}。为保证不破坏原有编码，自动保存已暂停。', { '0': state.meta.encoding.toUpperCase() })}</Frame>
    );
  }

  if (state.warnings.length > 0) {
    return (
      <Frame tone="info" title={t("提示")} testId="banner-warning">
        {state.warnings.join(' ')}
      </Frame>
    );
  }

  return null;
}
