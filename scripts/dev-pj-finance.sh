#!/usr/bin/env bash
# 一键启动 pj_finance Web + MCP，日志带前缀输出到当前终端（Ctrl+C 同时停止）
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# 缓解 Next.js Watchpack EMFILE
ulimit -n 10240 2>/dev/null || true

prefix() {
  local tag="$1"
  perl -pe "BEGIN{\$|=1} s/^/[$tag] /"
}

echo "pj_finance 开发栈"
echo "  Web   http://localhost:3000"
echo "  MCP   http://127.0.0.1:3001/mcp（Streamable HTTP，共享给 Claude/Cursor/Codex）"
echo "  Health http://127.0.0.1:3001/health"
echo "  停止  Ctrl+C"
echo

cleanup() {
  local pids
  pids=$(jobs -pr 2>/dev/null || true)
  if [[ -n "$pids" ]]; then
    kill $pids 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

npm run dev -w pj_finance 2>&1 | prefix web &
(
  npm run dev:mcp:http -w pj_finance
) 2>&1 | prefix mcp &

wait
