import { describe, expect, it } from 'vitest';
import { decideAutosave, type AutosaveInput } from '../../src/core/doc/autosavePolicy';

const base: AutosaveInput = {
  path: '/docs/a.md',
  dirty: true,
  saving: false,
  encoding: 'utf-8',
  integrityRisk: 'none',
  integrityAcknowledged: false,
  conflict: false,
  readonly: false,
  autoSaveEnabled: true,
  sourceMode: false,
};

describe('自动保存策略', () => {
  it('正常情况应当保存', () => {
    expect(decideAutosave(base).action).toBe('save');
  });

  it('没有路径（未命名）不保存', () => {
    expect(decideAutosave({ ...base, path: null }).action).toBe('skip');
  });

  it('没有改动不保存', () => {
    expect(decideAutosave({ ...base, dirty: false }).action).toBe('skip');
  });

  it('保存中不重复保存', () => {
    expect(decideAutosave({ ...base, saving: true }).action).toBe('skip');
  });

  it('存在冲突时阻止保存', () => {
    const d = decideAutosave({ ...base, conflict: true });
    expect(d.action).toBe('block');
    expect(d.action === 'block' && d.code).toBe('conflict');
  });

  it('只读文件阻止保存', () => {
    const d = decideAutosave({ ...base, readonly: true });
    expect(d.action === 'block' && d.code).toBe('readonly');
  });

  it('非 UTF-8 编码阻止保存', () => {
    const d = decideAutosave({ ...base, encoding: 'gb18030' });
    expect(d.action === 'block' && d.code).toBe('encoding');
  });

  it('未知编码阻止保存', () => {
    const d = decideAutosave({ ...base, encoding: 'unknown' });
    expect(d.action).toBe('block');
  });

  it('UTF-8 BOM 与 UTF-16 允许保存', () => {
    expect(decideAutosave({ ...base, encoding: 'utf-8-bom' }).action).toBe('save');
    expect(decideAutosave({ ...base, encoding: 'utf-16le' }).action).toBe('save');
  });

  it('可视化模式下文档会丢内容时阻止保存', () => {
    const d = decideAutosave({ ...base, integrityRisk: 'data-loss' });
    expect(d.action === 'block' && d.code).toBe('integrity');
  });

  it('用户确认后允许保存', () => {
    expect(decideAutosave({ ...base, integrityRisk: 'data-loss', integrityAcknowledged: true }).action).toBe('save');
  });

  it('源码模式不受完整性限制', () => {
    expect(decideAutosave({ ...base, integrityRisk: 'data-loss', sourceMode: true }).action).toBe('save');
  });

  it('仅书写风格差异不阻止保存', () => {
    expect(decideAutosave({ ...base, integrityRisk: 'cosmetic' }).action).toBe('save');
  });

  it('关闭自动保存后不写入', () => {
    expect(decideAutosave({ ...base, autoSaveEnabled: false }).action).toBe('skip');
  });

  it('冲突优先级高于一切', () => {
    const d = decideAutosave({ ...base, conflict: true, readonly: true, encoding: 'gb18030' });
    expect(d.action === 'block' && d.code).toBe('conflict');
  });
});
