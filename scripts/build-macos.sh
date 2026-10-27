#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"

if [[ "$(uname -s)" != Darwin ]]; then
  echo "请在 macOS 上运行此脚本。" >&2
  exit 1
fi

# 优先复用项目本地工具链，不修改用户的 shell 配置。
if [[ -x "$project_dir/.build-tools/cargo/bin/cargo" ]]; then
  export CARGO_HOME="$project_dir/.build-tools/cargo"
  export RUSTUP_HOME="$project_dir/.build-tools/rustup"
  export PATH="$CARGO_HOME/bin:$PATH"
fi

if ! command -v cargo >/dev/null; then
  echo "缺少 Rust 工具链，请先安装 Rust。" >&2
  exit 1
fi

# Hide build-machine paths in Rust diagnostics embedded in the distributed binary.
release_rust_flags="--remap-path-prefix=$HOME=/builder"$'\x1f'"--remap-path-prefix=$project_dir=/airmd"
export CARGO_ENCODED_RUSTFLAGS="${CARGO_ENCODED_RUSTFLAGS:+$CARGO_ENCODED_RUSTFLAGS$'\x1f'}$release_rust_flags"

npm run build:tauri -- --bundles app,dmg --ci -- --locked
mkdir -p release
for installer in src-tauri/target/release/bundle/dmg/*.dmg; do
  cp "$installer" release/
done
echo "Mac 安装包已复制到 $project_dir/release/"
