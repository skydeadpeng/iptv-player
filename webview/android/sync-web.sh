#!/bin/zsh
# webview/android/sync-web.sh — H5 构建产物同步到 Android assets
# 用法：./webview/android/sync-web.sh
set -e

# vite 需要 node 22（系统 node 21 跑不动），若本机装了 nvm 的 22.x 就优先用它
NODE_BIN="$HOME/.nvm/versions/node/v22.22.2/bin"
if [ -d "$NODE_BIN" ]; then
    export PATH="$NODE_BIN:$PATH"
fi

cd "$(dirname "$0")/../web"
npm run build
rsync -a --delete dist/ ../android/app/src/main/assets/web/
echo "synced: $(ls ../android/app/src/main/assets/web)"
