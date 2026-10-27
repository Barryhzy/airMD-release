import { t } from '../core/settings/language';
import { useEffect, useRef, type ReactNode } from 'react';

interface ModalProps {
  title: string;
  children?: ReactNode;
  onClose: () => void;
  onSubmit?: () => void;
  submitLabel?: string;
  cancelLabel?: string;
  testId?: string;
  secondaryAction?: { label: string; onClick: () => void };
}

export function Modal({
  title,
  children,
  onClose,
  onSubmit,
  submitLabel = t("确定"),
  cancelLabel = t("取消"),
  testId,
  secondaryAction,
}: ModalProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const previous = document.activeElement;
    if (!ref.current?.contains(previous)) ref.current?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div
      className="modal-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div ref={ref} className="modal" role="dialog" aria-modal="true" data-testid={testId}>
        <div className="modal__header">{title}</div>
        <div className="modal__body">{children}</div>
        <div className="modal__footer">
          <button type="button" className="modal__btn" onClick={onClose}>
            {cancelLabel}
          </button>
          {secondaryAction && (
            <button type="button" className="modal__btn" onClick={secondaryAction.onClick} data-testid="modal-discard">
              {secondaryAction.label}
            </button>
          )}
          {onSubmit && (
            <button type="button" className="modal__btn modal__btn--primary" onClick={onSubmit} data-testid="modal-submit">
              {submitLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
