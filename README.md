# airMD

**双击就能改，打开项目也能写。**

给 Vibe Coding 中不断增加的 Markdown 文件，一个像语雀一样顺手的本地编辑器。

简体中文 · [English](README.en.md)

[![Version](docs/badges/version.svg)](package.json)
[![MIT License](docs/badges/license.svg)](LICENSE)
![Tauri 2](docs/badges/tauri.svg)
![React 19](docs/badges/react.svg)
![Rust](docs/badges/rust.svg)
[![Star on GitHub](docs/badges/github-star.svg)](https://github.com/Barryhzy/airMD-release)

![所见即所得](docs/badges/editing-zh.svg)
![本地文件](docs/badges/local-files-zh.svg)
![离线使用](docs/badges/offline-zh.svg)
![多文档标签](docs/badges/workspace-zh.svg)

[下载安装](https://github.com/Barryhzy/airMD-release/releases) · [快速上手](#第一次使用) · [项目初衷](#为什么做-airmd) · [反馈建议](https://github.com/Barryhzy/airMD-release/issues)

airMD 是一个**免费、开源的 Markdown 桌面编辑器**。偶尔改一篇说明，双击打开就能写；每天处理一整个项目的文档，也能在文件树和多个标签之间切换。内容直接保存到本地 `.md` 文件，日常编辑完全离线。

![airMD 操作演示：输入 / 选择标题、编辑文字、待办、表格与源码切换](docs/demos/editing-demo.gif)

输入 `/` 选标题，直接写正文、加粗、勾选待办、填写表格，再切换源码看看 Markdown。

*约 23 秒，录制于浏览器演示环境；桌面版直接读写本地文件。*

## 为什么做 airMD

我在 Vibe Coding 时，项目里经常会多出一批 Markdown 文件：README、需求说明、实施计划、任务清单、Agent 交接记录……读完之后，还需要自己补充、调整和维护。

Markdown 语法很简单，但每次都对着源码改格式，对我来说还是不够顺手。我更习惯语雀那样的编辑方式：看到什么，就直接改什么。可本地项目里的文件，导入语雀再导出，又多了一轮来回搬运。

我也试过 Obsidian、Typora、VS Code。它们各有长处，但在我的使用习惯里，始终差一点我想要的便利：**双击本地文件就能改，改完还在原处；文档多起来时，打开项目就能接着写。**

所以有了 airMD。把我喜欢的文档编辑体验，带回本地 Markdown 文件。

## 一篇文档，或一整个项目

| 你的使用方式 | airMD 怎么帮你 |
| --- | --- |
| **偶尔改一篇** | 将 airMD 设为 Markdown 的默认打开应用，双击 `.md` 就能阅读、修改并自动保存。 |
| **每天改很多篇** | 打开项目文件夹，在左侧筛选和查找文档，用多个标签同时处理需求、计划与笔记。 |
| **跟着 AI 一起写** | 直接打开 Agent 生成的 Markdown，补充细节、调整任务清单，再让文件留在原来的项目目录。 |

既适合轻度使用时随手打开，也支持重度使用时在多篇文档之间持续工作。

## 让编辑顺手的几个细节

- **所见即所得**：标题、加粗、列表、待办、引用、代码块、表格、图片和链接，直接在文档里编辑；空段落输入 `/` 可插入内容。
- **原地打开，原地保存**：不需要导入导出，已有文件停止输入约 1 秒后自动写回，保存状态随时可见。
- **项目与多标签**：文件树和路径筛选帮助找到文档；切换标签保留编辑内容、滚动位置和撤销历史。
- **长文读写更轻松**：右侧大纲、标题折叠、字号调整，以及浅色和深色主题。
- **源码随时可用**：一键切换可视化与源码模式；遇到无法完整保留的内容，默认提示并使用源码模式。
- **按自己的习惯用**：支持 Windows 与 macOS、简体中文与 English；无需账号，文档由你自己保管。

## 界面一览

![airMD 中文界面：可视化编辑、待办清单、表格与大纲](docs/screenshots/readme-zh.jpg)

*浏览器演示界面；桌面版直接读写本地文件。*

## 安装

前往 [Releases](https://github.com/Barryhzy/airMD-release/releases) 下载 Windows 与 macOS 安装包。安装桌面版无需自行安装 Node.js 或 Rust。本次提供 Windows x64 和 Apple Silicon（arm64）版本。

| 系统 | 安装方式 |
| --- | --- |
| Windows 10 / 11 | 下载 `airMD_0.4.3_x64-setup.exe` 并按提示安装。 |
| macOS 11 及以上 | Apple Silicon Mac 下载 `airMD_0.4.3_aarch64.dmg`，打开后将 airMD 拖入「应用程序」。Intel Mac 需从源码构建。 |

如果尚未提供对应平台的安装包，可以按下方步骤从源码运行。当前 macOS 构建使用本地签名，尚未经过 Apple 开发者签名和公证。

## 第一次使用

**只改一个文件？** 安装后将 airMD 设为 `.md` 的默认打开应用，以后双击文件即可打开。也可以用右键菜单选择 airMD。

**想管理整个项目？** 点击「项目」选择文件夹，再从左侧文件树连续打开需要的文档，它们会显示为独立标签。

1. **打开文件**：点击「打开」选择 `.md` 文件；也可以点击「项目」打开笔记文件夹。
2. **开始写作**：像普通文档一样输入，用工具栏设置格式，或在空段落输入 `/` 插入内容。
3. **自动保存**：已有文件在停止输入约 1 秒后自动保存，可在状态栏确认保存状态。新建文档先按 `Ctrl/⌘ + S` 选择保存位置。

再次打开同一文件会定位到已有标签；切换标签会保留编辑内容和撤销历史。关闭仍有未保存改动的标签时，可选择保存、放弃或取消。

切换界面语言：右上角「…」→「界面语言 / Language」，保存设置并重启应用。

### 常用快捷键

Windows 使用 `Ctrl`，macOS 使用 `⌘`（标签切换除外）。

| 操作 | 快捷键 |
| --- | --- |
| 新建 / 打开文件 | `Ctrl/⌘ + N` / `Ctrl/⌘ + O` |
| 打开文件夹 | `Ctrl/⌘ + Shift + O` |
| 保存 / 另存为 | `Ctrl/⌘ + S` / `Ctrl/⌘ + Shift + S` |
| 加粗 / 斜体 | `Ctrl/⌘ + B` / `Ctrl/⌘ + I` |
| 撤销 / 重做 | `Ctrl/⌘ + Z` / `Ctrl/⌘ + Shift + Z` |
| 切换源码模式 | `Ctrl/⌘ + E` |
| 下一个 / 上一个标签 | `Ctrl + Tab` / `Ctrl + Shift + Tab`（两个平台均使用 Control） |

## 关于文件兼容性

airMD 主要支持 CommonMark 与 GitHub 风格 Markdown。可视化保存可能规范化列表符号、表格间距等写法。

**含 HTML 或 YAML frontmatter 的文档，默认使用源码模式保护原文。**「仍要可视化编辑」或「不再提示（所有 Markdown）」会允许继续编辑，但不会增加格式支持，保存时仍可能改变或丢失这些内容。需要原样保留时，请使用源码模式。

文件发生外部修改冲突、只读或编码不支持直接写回时，应用会提示处理。当前尚不支持 PDF/HTML 导出、文档内搜索替换，以及重启后恢复标签和未保存草稿。

桌面版的链接跳转尚不完整，当前建议使用文件树切换文档、右侧大纲定位章节；详见[已知限制](docs/KNOWN_LIMITATIONS.md)。

## 从源码运行

前端需要 **Node.js 22.12+** 和 npm。桌面版还需要 Rust 稳定版及对应系统的构建工具。

```bash
git clone https://github.com/Barryhzy/airMD-release.git
cd airMD-release
npm ci
npm run dev
```

在浏览器中打开 `http://localhost:1420`，选择示例文档即可体验。**浏览器演示的数据保存在浏览器本地存储中，不会直接写入电脑上的原文件**；清理浏览器数据会删除演示内容。

### 桌面开发与打包

- **macOS**：安装 Xcode Command Line Tools。
- **Windows**：安装 Visual Studio Build Tools 的「使用 C++ 的桌面开发」组件，使用 Rust MSVC 工具链，并确保已安装 WebView2。已有 MinGW 环境可使用下方脚本。

在完成上面的依赖安装后运行：

```bash
npm run dev:tauri      # 启动桌面开发版
npm run build:mac      # macOS：构建 .app 与 .dmg
npm run build:tauri    # Windows：构建 NSIS 安装包
```

macOS 的 `.dmg` 会复制到 `release/`；Windows 安装包位于 `src-tauri/target/release/bundle/nsis/`。

Windows 使用 GNU 工具链时，在 Git Bash 中指定完整 MinGW 的实际位置：

```bash
MINGW_BIN="C:/msys64/mingw64/bin" bash scripts/build-windows.sh
```

MinGW 构建时请将工程放在纯英文路径，并且只运行一个 Cargo 构建进程。

### 检查与测试

```bash
npm run build                # 类型检查与前端构建
npm test                     # 单元测试
npx playwright install chromium
npm run test:e2e             # 浏览器端到端测试
```

项目使用 Tauri 2、React、TypeScript 和 Milkdown。实现细节见 [架构说明](docs/ARCHITECTURE.md)。

## 反馈与贡献

欢迎提交 [Issue](https://github.com/Barryhzy/airMD-release/issues) 或 Pull Request。报告问题时，请附上应用版本、操作系统、复现步骤，以及方便公开的最小示例。

如果你也在 Vibe Coding 时积累了一堆 Markdown，或者一直想更顺手地编辑本地文档，欢迎给 airMD 一个 [Star](https://github.com/Barryhzy/airMD-release)。也欢迎告诉我，哪个编辑细节最让你觉得麻烦。

## 开源许可

[MIT](LICENSE)。欢迎使用、修改和分发。
