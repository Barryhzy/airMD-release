import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

interface PopoverProps {
  anchor: DOMRect | null;
  onClose: () => void;
  children: ReactNode;
  /** 与锚点的间距 */
  offset?: number;
  role?: string;
  testId?: string;
  /** 额外样式类，用于给具体菜单定宽 */
  className?: string;
}

const MARGIN = 8;

export function Popover({
  anchor,
  onClose,
  children,
  offset = 6,
  role = 'menu',
  testId,
  className,
}: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<{ left: number; top: number; visibility: 'hidden' | 'visible' }>({
    left: -9999,
    top: -9999,
    visibility: 'hidden',
  });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !anchor) return;
    const rect = el.getBoundingClientRect();
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;

    let left = anchor.left;
    if (left + rect.width > viewportW - MARGIN) left = viewportW - rect.width - MARGIN;
    if (left < MARGIN) left = MARGIN;

    let top = anchor.bottom + offset;
    if (top + rect.height > viewportH - MARGIN) {
      const above = anchor.top - rect.height - offset;
      top = above > MARGIN ? above : Math.max(MARGIN, viewportH - rect.height - MARGIN);
    }

    setStyle({ left, top, visibility: 'visible' });
  }, [anchor, offset, children]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (ref.current?.contains(target)) return;
      onClose();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className={`popover${className ? ` ${className}` : ''}`}
      role={role}
      data-testid={testId}
      style={{ left: style.left, top: style.top, visibility: style.visibility }}
    >
      {children}
    </div>
  );
}

/** 便捷：把元素变成「点击后弹出菜单」的锚点 */
export function useAnchor() {
  const [rect, setRect] = useState<DOMRect | null>(null);
  const open = (el: Element | null) => {
    if (!el) return;
    setRect(el.getBoundingClientRect());
  };
  const close = () => setRect(null);
  return { rect, open, close, isOpen: rect !== null };
}
