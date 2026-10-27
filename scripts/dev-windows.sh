#!/usr/bin/env bash
# Windows + GNU 工具链下启动桌面端开发模式（等价于 npm run dev:tauri，但自动配好工具链）
#
# 用法：MINGW_BIN="C:/dj-tools/mingw64/bin" ./scripts/dev-windows.sh

set -euo pipefail

MINGW_BIN="${MINGW_BIN:-C:/dj-tools/mingw64/bin}"

if [ ! -x "$MINGW_BIN/x86_64-w64-mingw32-gcc.exe" ]; then
  echo "找不到 $MINGW_BIN/x86_64-w64-mingw32-gcc.exe" >&2
  exit 1
fi

export PATH="$MINGW_BIN:$HOME/.cargo/bin:$PATH"
export CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER="$MINGW_BIN/x86_64-w64-mingw32-gcc.exe"

cd "$(dirname "$0")/.."
exec npx tauri dev
