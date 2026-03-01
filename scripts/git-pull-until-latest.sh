#!/usr/bin/env bash
# 反复执行 git pull，直到没有新提交（拉取到最新）再退出。
# 用法：在仓库根目录执行 ./scripts/git-pull-until-latest.sh 或 bash scripts/git-pull-until-latest.sh

set -e

cd "$(git rev-parse --show-toplevel)"

while true; do
  old_commit=$(git rev-parse HEAD)
  git pull
  new_commit=$(git rev-parse HEAD)
  if [ "$old_commit" = "$new_commit" ]; then
    echo "Already up to date."
    break
  fi
  echo "Pulled new commits, pulling again..."
done
