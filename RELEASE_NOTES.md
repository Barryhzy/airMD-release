# airMD v0.4.3

## 简体中文

像写文档一样编辑本地 Markdown。支持项目文件夹、多文档标签、自动保存、标题大纲和简体中文/English 界面。

### 本次附件

- `airMD_0.4.3_x64-setup.exe`：Windows x64 安装程序（2026-10-28 补充）。
- `airMD_0.4.3_aarch64.dmg`：macOS 11 及以上，Apple Silicon（M 系列）Mac。
- `airMD_0.4.3_aarch64.app.zip`：同一 Mac 应用的 ZIP 副本。
- `airMD-release-source-v0.4.3.zip`：清理后的完整源码快照。
- `SHA256SUMS.txt`：附件的 SHA-256 校验值。
- `airMD-release-source-manifest.json`：源码文件清单及各文件的 SHA-256。
- `RELEASE_NOTES.md`：本说明。

本次提供 Windows x64 和 Apple Silicon Mac 安装包；Intel Mac 安装包未提供。Windows 用户运行 EXE 并按提示安装。

源码 ZIP 和源码文件清单保留 `v0.4.3` 标签对应的初始快照；其中的下载可用性说明早于本次补充，以本 Release 当前附件和说明为准。

### 安装与校验

打开 DMG，将 airMD 拖到「应用程序」。Mac 构建使用 ad-hoc 本地签名，没有 Apple Developer ID 签名或 Apple 公证；下载后可能被 Gatekeeper 拦截，不宣称无需系统提示即可运行。

将附件下载到同一目录后，可运行：

```bash
shasum -a 256 -c SHA256SUMS.txt
```

应用附带项目 MIT 许可证与第三方许可清单。构建过程对个人路径做了重映射；发布产物已通过签名、内容和个人路径检查。

### 已知限制

- 桌面版链接导航尚未完整实现，可使用文件树打开文档、右侧大纲定位章节。
- 远程图片受离线策略限制；README 的徽章与截图已改为本地资源。
- HTML / YAML frontmatter 默认走源码模式；关闭提示不会增加可视化保真能力。
- 暂不支持重启恢复标签及未保存草稿、PDF/HTML 导出、文档内搜索替换。

## English

Edit local Markdown like a document. Includes project folders, document tabs, autosave, a heading outline, and Simplified Chinese/English interfaces.

This release includes a **Windows x64 NSIS installer** (added on 2026-10-28), a macOS 11+ **Apple Silicon (arm64)** DMG, the same Mac app as a ZIP, a source ZIP, a source-file manifest, and SHA-256 checksums. **No Intel Mac installer is included.** On Windows, run `airMD_0.4.3_x64-setup.exe` and follow the installer prompts.

The source ZIP and source-file manifest remain the original snapshot at tag `v0.4.3`. Download availability notes inside that snapshot predate the Windows asset addition; refer to this release's current assets and notes.

The Mac app is ad-hoc signed and has **no Apple Developer ID signature or notarization**. Gatekeeper may block it after download. This release does not claim a warning-free installation experience.

Open the DMG and drag airMD into Applications. Download the attached files into one directory and run `shasum -a 256 -c SHA256SUMS.txt` to verify them. Project and third-party license notices are included in the app.

Known limitations: desktop link navigation is incomplete; remote images are restricted; HTML/frontmatter preservation requires source mode; session/draft restoration, PDF/HTML export, and in-document find/replace are not implemented. See [known limitations](https://github.com/Barryhzy/airMD-release/blob/main/docs/KNOWN_LIMITATIONS.md) in the source tree.
