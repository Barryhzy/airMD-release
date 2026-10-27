# 架构说明

## 一句话

每个文档的 `DocumentController` 是该文档的事实来源，`WorkspaceController` 管理多个文档标签及当前选择；文件字节与编辑器内容之间只允许经过两条路：
**codec（字节层保真）** 和 **integrity（语义层校验）**。

## 数据流

```
磁盘字节
  │  fs.readFile()                         ← FsAdapter（Tauri / 浏览器）
  ▼
decodeDocument(bytes)                      ← 编码 / BOM / 换行识别，产出 TextMeta
  │  { text（\\n 归一化）, meta, warnings }
  ▼
scanUnsupportedSyntax(text)                ← 静态扫描 html / frontmatter
  │
  ├─ 命中 → 直接进源码模式（不碰编辑器）
  │
  └─ 未命中 → crepe.create({ defaultValue: text })
                │
                ▼
            readMarkdown(crepe)            ← 编辑器自己的序列化结果
                │
                ▼
            assessRoundTrip(text, out)     ← 两边都按 CommonMark + GFM 解析成 AST 比较
                │
                ├─ risk = data-loss → 销毁编辑器，退回源码模式 + 横幅
                └─ 否则 → 保留在可视化模式
```

保存时反向走一遍：

```
getText() → encodeDocument(text, meta) → fs.writeFile()   （原子写）
```

## 为什么「源码模式」是兜底路径而不是附加功能

Markdown 的表达力大于 ProseMirror Schema 的表达力。任何富文本编辑器都只能表达
它能理解的那部分子集；剩下的部分如果没有兜底，就会在第一次保存时被静默删除。

所以源码模式不是「给高级用户的功能」，而是**数据完整性的最后一道闸门**：

- 编辑器能完整表达 → 可视化模式，用户无感知。
- 编辑器不能完整表达 → 源码模式 + 明确告知，用户仍然可以正常编辑和保存。

判定完全自动化（AST 比较），不需要维护「不支持语法清单」这种容易过时的东西。

## 状态机

v0.4.1 每个标签独立持有一个 `DocumentController` 和持续挂载的 `DocumentPane`，保留撤销历史、模式、选区和滚动。`WorkspaceController` 串行管理打开、去重、切换、关闭及手动保存；切换只同步输入，关闭才调用单文档的安全离开流程。窗口退出遍历所有标签，另存为不能覆盖其他标签占用的文件。实现见 [WorkspaceController.ts](../src/core/doc/WorkspaceController.ts)。

`DocumentController` 持有：

| 字段           | 含义                                         |
| ------------ | ------------------------------------------ |
| `#text`      | 当前权威文本（`\n` 归一化）                           |
| `#savedText` | 上次成功写到磁盘的文本；`dirty = #text !== #savedText` |
| `#lastStat`  | 上次读写后的 mtime/size，用于外部修改检测                 |
| `#handle`    | Crepe 实例；源码模式下可隐藏保留并复用                    |
| `#editorDoc` / `#editorMarkdown` | 已同步的可视化文档节点及其序列化表示；首次表示复用完整性检查结果 |

保存、新建、打开、模式切换、冲突处理与外部修改检查共用一个串行操作队列，正文输入仍可继续。
写入使用独立的文本快照；完成后只更新 `#savedText`，不会用旧快照覆盖期间的新输入，仍脏时重新安排自动保存。
`documentId` 在新建/打开时递增，用于重置手柄、右键菜单和大纲的文档内位置，取消切换不递增。
`contentVersion` 只在正文变化时递增。工具栏通过独立订阅读取格式、块类型及撤销/重做状态；
选区变化按 rAF 合并，相同格式状态不通知，也不发布整个文档快照。

模式切换的语义：

- `wysiwyg → source`：通过 `getText()` 同步即时输入并复用当前序列化结果，隐藏并保留编辑器。此后源码文本是权威。
- `source → wysiwyg`：源码未改动时复用实例；改动后重建编辑器并**重新做一次往返体检**。

之所以每次进入可视化模式都体检，是因为用户可能在源码模式里改出了新的、
编辑器无法表达的语法。

## 自动保存的时序

```
editor.markdownUpdated
  → handleEditorChange(markdown, doc): 节点匹配时复用文本；dirty = ...
  → decideAutosave()  ── block/skip ──▶ 不动
        │ save
        ▼
   debounce 900ms
        ▼
   save():  stat() 前再比对一次 #lastStat
            ├─ 变了 → 置 conflict，放弃本次保存
            └─ 没变 → encodeDocument → atomic_write → 更新 #lastStat
```

失焦调用 `flush()`。新建、打开其他文件和 `prepareToClose()` 则先读取编辑器的最新文档，
不依赖 200ms 内容通知；安全自动保存后仍脏时通过 `confirmUnsaved` 请求保存/放弃/取消。
取消或保存失败都不能离开当前文档；明确重新载入冲突文件才直接放弃本地版本。
`getText()` 和保存前的同步比较当前文档节点；防抖结果尚未到达时才即时序列化，后续读取复用缓存。
首次完整性检查的序列化表示与原始文本分别保留，避免改变已有的源码往返行为。

组合输入开始时暂停自动保存和选区界面通知，保存/切换操作等待组合输入结束。
组合结束后等一帧让 ProseMirror 与输入规则完成 DOM 同步，再读取正文并恢复保存。
组合取消后通过文档结构比较识别「没有实际改动」，避免把 Markdown 写法规范化当成一次编辑。

## 外部修改检测

每 1500ms 轮询 `stat`（比 `notify` 更简单，也不受编辑器保存时临时文件事件的干扰）：

- `statChanged(#lastStat, now)` 为假 → 什么都不做。
- 变了且本地**没有**未保存改动 → 直接重新载入（用户视角是「自动同步」）。
- 变了且本地**有**未保存改动 → 暂停自动保存，弹出冲突横幅三选一：
  重新载入 / 用本地覆盖 / 另存为。

## 为什么用自定义 Rust 命令而不是 tauri-plugin-fs

| 需求                  | plugin-fs  | 自定义命令        |
| ------------------- | ---------- | ------------ |
| 原子写（临时文件 + rename）  | ✗          | ✓            |
| 返回 mtime / readonly | 部分         | ✓            |
| 读任意目录的图片            | 需要放宽 scope | ✓（用户主动打开的文件） |
| 编码无损回写              | ✗          | ✓（配合 codec）  |

手动和自动保存共用只读、编码、冲突及完整性保护。`same_file` 用系统规范路径识别别名，
另存为原文件时仍走原文件的保存保护；转换不安全编码只能选择新的路径。
Rust 写入使用 `create_new` 临时文件、保留权限、`sync_all` 后替换，任何失败都不直接覆盖原文件。

## 平台差异

| 能力      | Windows                                         | macOS                                    |
| ------- | ----------------------------------------------- | ---------------------------------------- |
| 双击打开    | 单实例插件转发 argv → `emit('open-file')`              | `RunEvent::Opened` → `emit('open-file')` |
| 原子写     | `MoveFileEx(REPLACE_EXISTING)`（`fs::rename` 底层） | `rename(2)`                              |
| 文件管理器定位 | `explorer /select,`                             | `open -R`                                |
| 构建目标    | `nsis`                                          | `dmg` / `app`                            |

## 编辑器交互层（手柄 / 菜单 / 大纲）

项目文件夹功能独立于文档状态：`core/project/ProjectController.ts` 管理索引、刷新和偏好；
Rust `project.rs` 在后台只遍历目录项。`ProjectSidebar` 和顶部项目按钮单独订阅项目状态，
文件选择复用 `DocumentController.openPath()`，不绕过保存保护。实现见 [ProjectController.ts](../src/core/project/ProjectController.ts)。

这三块都挂在编辑器 DOM 外围，不改文档模型，但有几个必须知道的约定：

- **块手柄**（`ui/BlockHandle.tsx`）位置只在三种情况下重算：鼠标换块、块被重建、块几何变化。
  同块内移动一律跳过，避免 mousemove 每次都 `getBoundingClientRect` + `setState`。
  文档变化而鼠标不动时，用 `document.elementFromPoint(最后指针坐标)` 找回「指针下面的块」，
  所以回车/换标题/插入之后手柄都会自动跟过去。
  布局检查由内容版本、滚动和 `ResizeObserver` 驱动，不跟随每次 React 渲染；同帧请求合并。
  鼠标命中和滚动检查分别排队，防止表格自身滚动取消刚命中的块。
- **块菜单**用 `commands.blockKindAt(editor, pos)` 读当前样式，读的是**悬停块**而不是选区，
  因此光标在别处也能正确显示「当前：标题 2」。
- **引用内退格**（`core/editor/quoteBackspace.ts`）走 `editorViewOptionsCtx.handleKeyDown`，
  这是唯一能抢在核心 keymap 之前的口子；普通 `$prose` 插件排在后面，拦不到 Backspace。
  必须 `crepe.create()` 之前挂上，因为 `handleKeyDown` 是建视图时读取的。
- **标题折叠**（`core/editor/headingFold.ts`）使用 ProseMirror PluginState 保存折叠标题位置，
  通过 node decoration 隐藏标题之后、同一容器内下一个同级或更高级标题之前的节点。
  折叠箭头是 widget decoration；不修改 schema、Markdown 或撤销历史。
  编辑时通过 transaction mapping 跟随标题位置；收起光标所在章节时将光标移回标题，
  大纲跳转或键盘操作进入隐藏内容时由 appendTransaction 展开对应祖先。
- **大纲**（`ui/Outline.tsx`）靠 `contentVersion` 及编辑器实例变化触发，防抖 220ms 后扫描标题；选区和保存状态不触发扫描。
  滚动高亮通过 `view.nodeDOM(pos)` 定位真实标题，并跳过已隐藏的标题。
  大纲分支的展开状态独立于正文折叠；隐藏侧栏时保留组件，避免丢失分支状态。
- **正文字号**（`ui/useDocFontSize.ts`）是**视图偏好**，不是文档属性：只往 `<html>` 写
  `--doc-font-size` / `--doc-font-scale` 两个变量并存 localStorage，不经过 `DocumentController`，
  所以调字号既不会把文档标脏，也不会触发自动保存或产生冲突。
  取值 / 步长 / 脏数据容错放在 `core/settings/fontSize.ts` 里做成纯函数，单独可测。
- **表格**（`core/editor/tableCommands.ts` + `ui/TableMenu.tsx`）只依赖 prosemirror-tables 的
  公开能力：`cellAround` 定位单元格、`CellSelection.rowSelection/colSelection` 选行列、
  `addRow*` / `delete*` 改结构。**不要**去操作 Crepe 的 Vue 表格 DOM，它随时可能变。
- **构造表格必须用预设的 `createTable(ctx, rows, cols)`**：GFM schema 里表格是
  `table_header_row table_row+`，首行是独立节点类型（内容 `(table_header)*`），
  手搓 `table_row` + `table_header` 会得到一个 schema 非法的文档 —— 能显示、能保存，
  但任何一次内容校验都会抛 `Called contentMatchAt on a node with invalid content`，
  随后编辑器对每个按键都抛错，等于整篇文档废掉。
- **表格里的 Ctrl+A**（`core/editor/tableSelectAll.ts`）必须走 `handleKeyDown`：默认的 `selectAll`
  不区分上下文，会把整篇文档选中，配合退格就是一次静默的全文件清空。这里拦下来做三级递进
  （整表单元格 → 表格节点 → 整篇），和引用退格共用一个入口，注意链式调用 `prev.handleKeyDown`。
- **单击表格编辑**（`core/editor/tableCellEditing.ts`）在 pointerdown/mousedown 捕获阶段把光标放入当前格，
  让 Crepe 不再安排延迟的块选区；保留右键、组合键和范围选择的既有行为。
- **手柄操作**在执行前由当前 DOM 读取块位置和长度，避免悬停后继续输入时使用过期长度截断段落。

## 测试策略

- **纯函数优先**：编码、完整性判定、自动保存策略、路径解析全部做成无副作用的函数，
  用 Vitest 覆盖所有分支。这四块是整个应用的风险集中区。
- **E2E 覆盖真实链路**：Playwright 跑生产构建，走 `browserFs`（localStorage 虚拟盘），
  因此可以在没有 Rust、没有真实文件系统的 CI 里验证「打开 → 编辑 → 自动保存 → 重开」。
- **不 mock 编辑器**：E2E 里的编辑、快捷键、块菜单都是真实操作 ProseMirror，
  避免「测试通过但实际不能用」。


