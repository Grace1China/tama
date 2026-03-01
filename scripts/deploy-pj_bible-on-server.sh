#!/usr/bin/env bash
# 在服务器上执行：拉取 pj_bible 分支并重启 pm2 应用 pj_bible
# 用法：在服务器上放置此脚本后，由 publishBook 服务调用；或手动执行：
#   PROJECT_DIR=/path/to/tama_pd ./scripts/deploy-pj_bible-on-server.sh

set -e

# 项目根目录（克隆的 git 仓库），服务器上需根据实际路径设置
: "${PROJECT_DIR:=$(cd "$(dirname "$0")/.." && pwd)}"
cd "$PROJECT_DIR"

echo "[$(date -Iseconds)] Pulling pj_bible..."
git fetch origin pj_bible
git checkout pj_bible
git pull origin pj_bible

echo "[$(date -Iseconds)] Restarting pm2 app pj_bible..."
pm2 restart pj_bible

echo "[$(date -Iseconds)] Done."
