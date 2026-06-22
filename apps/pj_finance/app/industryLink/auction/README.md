# 集合竞价快照

本目录存放 MyQuant 集合竞价 Tick 采集结果。

## 文件

- `latest.json`: 每只股票最新一条集合竞价快照，供 Next.js API 快速读取。
- `auction_snapshots.jsonl`: 采集期间追加的 Tick 快照流水，每行一个 JSON。

## 采集

示例：

```bash
python apps/pj_finance/scripts/myquant_auction_collector.py \
  --codes 300308.SZ,300502.SZ,300394.SZ \
  --allow-outside-window
```

生产运行建议在交易日 9:15 前启动，不加 `--allow-outside-window`，脚本会在 9:25 后退出。

## MyQuant 依赖

需要安装掘金量化 Python SDK，并配置有效 token。脚本会优先尝试：

```python
from gm.api import *
```

并使用 `subscribe(..., include_call_auction=True)` 开启 9:15-9:25 集合竞价 Tick。

安装后可先用下面命令确认当前 Python 是否能导入官方 SDK：

```bash
python apps/pj_finance/scripts/check_myquant_sdk.py
```

注意：PyPI 上的 `gmapi` 不是掘金量化 SDK，不提供 `gm.api`。
