#!/usr/bin/env bash
# 在 Windows 上用 GNU(MinGW) 工具链构建桌面端。
#
# 前置：装好完整的 mingw-w64（gcc + binutils + crt + headers），
# 例如 MSYS2 的 mingw64 目录，或 winget 的 WinLibs 解压目录。
#
# 用法：
#   MINGW_BIN="C:/dj-tools/mingw64/bin" ./scripts/build-windows.sh
#   MINGW_BIN="C:/dj-tools/mingw64/bin" ./scripts/build-windows.sh --debug
#
# 说明：
#   - rustup 自带的 rust-mingw 只有链接桩，缺 as.exe / gcc，必须用完整工具链。
#   - 工程路径不能含中文，否则 windres / dlltool 会报文件不存在。

set -euo pipefail

MINGW_BIN="${MINGW_BIN:-C:/dj-tools/mingw64/bin}"

if [ ! -x "$MINGW_BIN/x86_64-w64-mingw32-gcc.exe" ]; then
  echo "找不到 $MINGW_BIN/x86_64-w64-mingw32-gcc.exe" >&2
  echo "请通过环境变量指定完整的 mingw-w64 bin 目录：" >&2
  echo "  MINGW_BIN=\"C:/msys64/mingw64/bin\" ./scripts/build-windows.sh" >&2
  exit 1
fi

export PATH="$MINGW_BIN:$HOME/.cargo/bin:$PATH"
export CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER="$MINGW_BIN/x86_64-w64-mingw32-gcc.exe"

cd "$(dirname "$0")/.."

echo "==> 构建前端"
npm run build

echo "==> 构建桌面端"
if [ "${1:-}" = "--debug" ]; then
  (cd src-tauri && cargo build)
  echo "产物：src-tauri/target/debug/airmd.exe"
else
  npx tauri build
  echo "产物：src-tauri/target/release/bundle/"
fi
