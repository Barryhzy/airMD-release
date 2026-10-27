import { useEffect, useMemo, useRef } from 'react';

interface SourceEditorProps {
  active?: boolean;
  value: string;
  onChange: (value: string) => void;
  onCompositionChange: (composing: boolean) => void;
}

/** 源码模式：纯文本编辑，不做任何 Markdown 语法解析，保证零丢失 */
export function SourceEditor({ active = true, value, onChange, onCompositionChange }: SourceEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const gutterRef = useRef<HTMLDivElement | null>(null);
  const compositionFrame = useRef(0);

  const lineCount = useMemo(() => {
    let count = 1;
    for (let i = 0; i < value.length; i += 1) {
      if (value.charCodeAt(i) === 10) count += 1;
    }
    return count;
  }, [value]);

  useEffect(() => {
    if (active) textareaRef.current?.focus();
    return () => cancelAnimationFrame(compositionFrame.current);
  }, [active]);

  const numbers = useMemo(() => {
    const arr: number[] = [];
    const max = Math.min(lineCount, 20000);
    for (let i = 1; i <= max; i += 1) arr.push(i);
    return arr;
  }, [lineCount]);

  const syncScroll = () => {
    const area = textareaRef.current;
    const gutter = gutterRef.current;
    if (!area || !gutter) return;
    gutter.style.transform = `translateY(${-area.scrollTop}px)`;
  };

  return (
    <div className="source-editor" data-testid="source-editor">
      <div className="source-editor__gutter" aria-hidden="true">
        <div ref={gutterRef}>
          {numbers.map((n) => (
            <div key={n}>{n}</div>
          ))}
        </div>
      </div>
      <textarea
        ref={textareaRef}
        className="source-editor__area"
        data-testid="source-textarea"
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
        wrap="off"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onCompositionStart={() => {
          cancelAnimationFrame(compositionFrame.current);
          onCompositionChange(true);
        }}
        onCompositionEnd={() => {
          compositionFrame.current = requestAnimationFrame(() => {
            if (textareaRef.current) onChange(textareaRef.current.value);
            onCompositionChange(false);
          });
        }}
        onScroll={syncScroll}
      />
    </div>
  );
}
