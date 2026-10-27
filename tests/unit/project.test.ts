import { describe, expect, it, vi } from 'vitest';
import { ProjectController } from '../../src/core/project/ProjectController';
import { buildProjectTree } from '../../src/core/project/tree';
import type { ProjectIndex } from '../../src/core/fs/types';

const index = (root: string): ProjectIndex => ({ root, files: [{ path: `${root}/a.md`, relativePath: 'a.md' }], warnings: [], scannedDirectories: 1, elapsedMs: 0 });
function setup() {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const fs = { openFolderDialog: vi.fn<() => Promise<string | null>>(async () => '/project'), scanProject: vi.fn(async (root: string) => index(root)) };
  return { fs, values, storage, controller: new ProjectController(fs, storage) };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}

describe('ProjectController', () => {
  it('opens the chosen folder, restores its canonical root and visibility', async () => {
    const { controller, fs, storage } = setup();
    fs.scanProject.mockResolvedValue(index('/canonical'));
    await controller.openViaDialog();
    expect(controller.getSnapshot().root).toBe('/canonical');
    controller.toggle();
    const restored = new ProjectController(fs, storage);
    await restored.restore();
    expect(fs.scanProject).toHaveBeenLastCalledWith('/canonical');
    expect(restored.getSnapshot().visible).toBe(false);
    expect(restored.getSnapshot().index?.files).toHaveLength(1);
  });

  it('cancelling the chooser leaves the existing project untouched', async () => {
    const { controller, fs } = setup();
    await controller.open('/existing');
    const before = controller.getSnapshot();
    fs.openFolderDialog.mockResolvedValue(null);
    await controller.openViaDialog();
    expect(controller.getSnapshot()).toBe(before);
    expect(fs.scanProject).toHaveBeenCalledTimes(1);
  });

  it('ignores late results and errors after switching projects', async () => {
    const { controller, fs } = setup();
    const first = deferred<ProjectIndex>();
    fs.scanProject.mockReturnValueOnce(first.promise);
    const old = controller.open('/old');
    await controller.open('/new');
    first.resolve(index('/old'));
    await old;
    expect(controller.getSnapshot().root).toBe('/new');
    const failed = deferred<ProjectIndex>();
    fs.scanProject.mockReturnValueOnce(failed.promise);
    const older = controller.open('/older');
    await controller.open('/current');
    failed.reject(new Error('missing'));
    await older;
    expect(controller.getSnapshot().error).toBeNull();
    expect(controller.getSnapshot().root).toBe('/current');
  });

  it('closing or disposing prevents a pending scan from reopening the project', async () => {
    const { controller, fs, values } = setup();
    const scan = deferred<ProjectIndex>();
    fs.scanProject.mockReturnValueOnce(scan.promise);
    const opened = controller.open('/old');
    controller.close();
    scan.resolve(index('/old'));
    await opened;
    expect(controller.getSnapshot().root).toBeNull();
    expect(values.has('airmd.projectRoot')).toBe(false);
    const second = deferred<ProjectIndex>();
    fs.scanProject.mockReturnValueOnce(second.promise);
    const pending = controller.open('/next');
    const notify = vi.fn();
    controller.subscribe(notify);
    controller.dispose();
    second.resolve(index('/next'));
    await pending;
    expect(notify).not.toHaveBeenCalled();
  });

  it('keeps the last index when refresh fails, and allows retry', async () => {
    const { controller, fs } = setup();
    await controller.open('/project');
    const before = controller.getSnapshot().index;
    fs.scanProject.mockRejectedValueOnce(new Error('permission denied'));
    await controller.refresh();
    expect(controller.getSnapshot().index).toBe(before);
    expect(controller.getSnapshot().error).toContain('permission denied');
    await controller.refresh();
    expect(controller.getSnapshot().error).toBeNull();
  });

  it('does not overlap refreshes or scan when no project is open', async () => {
    const { controller, fs } = setup();
    await controller.refresh();
    expect(fs.scanProject).not.toHaveBeenCalled();
    const scan = deferred<ProjectIndex>();
    fs.scanProject.mockReturnValueOnce(scan.promise);
    const opened = controller.open('/project');
    await controller.refresh();
    expect(fs.scanProject).toHaveBeenCalledTimes(1);
    scan.resolve(index('/project'));
    await opened;
  });

  it('continues to work when preference storage is unavailable', async () => {
    const { fs } = setup();
    const fail = () => { throw new Error('storage disabled'); };
    const controller = new ProjectController(fs, { getItem: fail, setItem: fail, removeItem: fail });
    await controller.restore();
    await controller.open('/project');
    expect(controller.getSnapshot().index?.root).toBe('/project');
    controller.close();
  });
});

it('builds directory-first trees with duplicate basenames, native paths and Unicode', () => {
  const files = [
    { path: 'C:\\项目\\README.md', relativePath: 'README.md' },
    { path: 'C:\\项目\\docs\\a.md', relativePath: 'docs/a.md' },
    { path: 'C:\\项目\\docs\\子目录\\a.md', relativePath: 'docs/子目录/a.md' },
    { path: 'C:\\项目\\10.md', relativePath: '10.md' },
    { path: 'C:\\项目\\2.md', relativePath: '2.md' },
  ];
  const tree = buildProjectTree(files);
  expect(tree.map((node) => node.name)).toEqual(['docs', '2.md', '10.md', 'README.md']);
  expect(tree[0].children.map((node) => node.name)).toEqual(['子目录', 'a.md']);
  expect(tree[0].children[0].children[0].file).toBe(files[2]);
});
