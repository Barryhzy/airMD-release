# 已知限制 / Known limitations

## 0.4.3

- 桌面版链接导航尚未完整接入：本地 Markdown 链接不会自动打开文档标签，外部网页未接入系统浏览器，文内锚点未接入标题定位。当前可使用文件树与大纲。
- Desktop link navigation is incomplete: local Markdown links do not open document tabs, external URLs are not connected to the system browser, and document anchors are not connected to heading navigation. Use the file tree and outline for now.
- 远程图片受桌面版离线策略限制。README 徽章和截图已使用本地文件，随源码一起保留即可显示。
- Remote images are restricted by the desktop app's offline policy. README badges and screenshots are local assets bundled with this source tree.
- HTML 与 YAML frontmatter 默认通过源码模式保留；关闭提醒不会增加可视化编辑器的保真能力。
- HTML and YAML frontmatter use source mode by default. Suppressing the warning does not add support for preserving them in visual mode.
- 尚不支持重启恢复标签及未保存草稿、PDF/HTML 导出、文档内搜索替换。
- Session restoration, unsaved draft recovery after restart, PDF/HTML export, and in-document find and replace are not implemented.

- 本次提供 Windows x64 和 Apple Silicon Mac 安装包；没有 Intel Mac 安装包。Mac 构建没有 Apple Developer ID 签名或公证。
- This release provides Windows x64 and Apple Silicon Mac installers. Intel Mac installers are not included. The Mac app has no Apple Developer ID signature or notarization.
