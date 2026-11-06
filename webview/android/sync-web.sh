#!/bin/zsh
# webview/android/sync-web.sh — H5 构建产物同步到 Android assets
# 用法：./webview/android/sync-web.sh
#
# node 版本：vite 构建需要 node >= 22（本项目在 node 22.x 上验证；系统 node 21 跑不动 vite）。
# 这里动态解析 node，绝不写死某个 nvm 版本目录：
#   1) 先看 PATH 上的 node，主版本 >= 22 就用它；
#   2) 否则尝试 nvm 的 22.x（nvm which 22 / nvm use 22）；
#   3) 都不可用 → 打印明确错误并 exit 1（静默回落到错误版本会让构建以晦涩错误失败）。
set -e

MIN_NODE_MAJOR=22

# 从 `node -v`（形如 v22.22.2）里取主版本号
node_major_of() {
  "$1" -v 2>/dev/null | sed -E 's/^v([0-9]+).*/\1/' | head -n 1
}

# 判断某个可执行文件是否是可用的 node（>= $MIN_NODE_MAJOR）
node_ok() {
  local bin="$1" major
  [ -n "$bin" ] || return 1
  [ -x "$bin" ] || return 1
  major="$(node_major_of "$bin")"
  case "$major" in
    ''|*[!0-9]*) return 1 ;;
  esac
  [ "$major" -ge "$MIN_NODE_MAJOR" ]
}

# 解析可用的 node 路径；找不到返回 1
resolve_node() {
  local bin nvm_dir
  # 1) PATH 上的 node
  bin="$(command -v node 2>/dev/null || true)"
  if node_ok "$bin"; then
    echo "$bin"
    return 0
  fi
  # 2) nvm 里的 22.x
  nvm_dir="${NVM_DIR:-$HOME/.nvm}"
  if [ -s "$nvm_dir/nvm.sh" ]; then
    . "$nvm_dir/nvm.sh"
    if command -v nvm >/dev/null 2>&1; then
      bin="$(nvm which 22 2>/dev/null || true)"
      if node_ok "$bin"; then
        echo "$bin"
        return 0
      fi
      nvm use 22 >/dev/null 2>&1 || true
      bin="$(command -v node 2>/dev/null || true)"
      if node_ok "$bin"; then
        echo "$bin"
        return 0
      fi
    fi
  fi
  return 1
}

NODE_BIN="$(resolve_node)" || {
  echo "错误：未找到 node >= ${MIN_NODE_MAJOR}，无法构建 H5（vite 需要 node 22）。" >&2
  echo "  PATH 上的 node：$(command -v node 2>/dev/null || echo '无') $(node -v 2>/dev/null || echo '')" >&2
  echo "  nvm 目录：${NVM_DIR:-$HOME/.nvm}" >&2
  echo "  修复方式：安装或切换到 node ${MIN_NODE_MAJOR}，例如 'nvm install ${MIN_NODE_MAJOR} && nvm use ${MIN_NODE_MAJOR}'" >&2
  exit 1
}

export PATH="$(dirname "$NODE_BIN"):$PATH"
echo "使用 node：$NODE_BIN ($("$NODE_BIN" -v))"

cd "$(dirname "$0")/../web"
npm run build
rsync -a --delete dist/ ../android/app/src/main/assets/web/
echo "synced: $(ls ../android/app/src/main/assets/web)"
