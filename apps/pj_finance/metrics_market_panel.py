#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
全市场 × 全时序 metrics 面板：对每只股票调用 `/api/metrics?series=true`，
将返回的 points 纵向合并为大表（行 ≈ ts_code × period）。

后续分析在 pandas / Excel / notebook 人工完成即可；脚本不做筛选。

试跑可先 --limit-stocks 10 --metrics「市值+DCF」等小集合；可加 --merge-stock-basic 并入名称/行业。

metrics 可由以下方式任选其一传入：
--metrics 逗号列表
--metrics-file 文本（逗号或换行分隔）
--all-registry-metrics 从 lib/metrics/definitions.ts 解析顶层指标键（与引擎注册表尽量同步）
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any

import pandas as pd
import requests

from metrics_pull_common import (
    DEFAULT_BASE_URL,
    METRICS_PATH,
    chunk_list,
    fetch_stock_list_all_rows,
    load_ts_codes_from_file,
    load_ts_codes_from_parquet,
    load_ts_codes_from_stock_list_api,
)

SERIES_TIMEOUT_SEC = float(os.environ.get("DCF_PANEL_SERIES_TIMEOUT", "480"))

_DEFINITIONS_TS_DEFAULT = Path(__file__).resolve().parent / "lib/metrics/definitions.ts"

# stockList CSV 英文字段中与「基本信息」常用的列（存在则并入面板）
_STOCK_BASIC_MERGE_COLS = [
    "ts_code",
    "symbol",
    "name",
    "area",
    "industry",
    "fullname",
    "market",
    "list_date",
    "list_status",
]


def parse_registry_metric_keys(definitions_ts: Path) -> list[str]:
    """解析 lib/metrics/definitions.ts 中 MetricRegistry 顶层键名"""
    text = definitions_ts.read_text(encoding="utf-8")
    keys = re.findall(r"^  (\w+): \{", text, flags=re.MULTILINE)
    return sorted(set(keys))


def load_metric_names_from_arg(metrics_arg: str) -> list[str]:
    ms: list[str] = []
    for line in metrics_arg.replace(",", " ").split():
        x = line.strip()
        if x:
            ms.append(x)
    return sorted(set(ms))


def enrich_panel_with_stock_basic(
    panel: pd.DataFrame, base_url: str, stock_list_page_size: int
) -> pd.DataFrame:
    """从 /api/csv/stockList 拉全表（一次缓存），按 ts_code 左连接常用基本面列"""
    if "ts_code" not in panel.columns:
        return panel
    rows = fetch_stock_list_all_rows(base_url, stock_list_page_size)
    if not rows:
        return panel
    basics = pd.DataFrame(rows)
    if basics.empty or "ts_code" not in basics.columns:
        return panel
    basics["ts_code"] = basics["ts_code"].astype(str).str.strip().str.upper()
    cols = [c for c in _STOCK_BASIC_MERGE_COLS if c in basics.columns]
    basics = basics[cols].drop_duplicates(subset=["ts_code"], keep="first")
    return panel.merge(basics, on="ts_code", how="left")


def load_metric_names_from_file(path: Path) -> list[str]:
    ms: list[str] = []
    for line in path.read_text(encoding="utf-8").replace(",", "\n").splitlines():
        for p in line.split(","):
            x = p.strip()
            if x:
                ms.append(x)
    return sorted(set(ms))


def metrics_series_url(
    base: str,
    stock: str,
    metrics: list[str],
    from_period: str | None,
    to_period: str | None,
    years: int | None,
    industry_growth_pct: float | None,
) -> str:
    from urllib.parse import urlencode

    q: dict[str, str] = {"stock": stock, "metrics": ",".join(metrics), "series": "true"}
    if from_period:
        q["from"] = from_period
    if to_period:
        q["to"] = to_period
    if years is not None:
        q["years"] = str(years)
    if industry_growth_pct is not None:
        q["industry_growth_pct"] = str(industry_growth_pct)
    return f"{base.rstrip('/')}{METRICS_PATH}?{urlencode(q)}"


def fetch_one_stock_series(
    base_url: str,
    stock: str,
    metrics: list[str],
    from_period: str | None,
    to_period: str | None,
    years: int | None,
    industry_growth_pct: float | None,
) -> tuple[pd.DataFrame, dict[str, Any] | None]:
    """
    单次 series 请求；返回 (DataFrame, 可选的 metrics 元信息)。
    metrics 元信息取自 API 顶层 body['metrics']，用于记录单位标签等。
    """
    url = metrics_series_url(
        base_url, stock, metrics, from_period, to_period, years, industry_growth_pct
    )
    sess = requests.Session()
    sess.headers.setdefault("Accept", "application/json")
    try:
        r = sess.get(url, timeout=SERIES_TIMEOUT_SEC)
    except requests.RequestException as exc:
        return (
            pd.DataFrame(
                [{"ts_code": stock, "period": pd.NA, "fetch_exception": repr(exc)}]
            ),
            None,
        )

    try:
        body = r.json()
    except json.JSONDecodeError:
        snippet = r.text[:500]
        return (
            pd.DataFrame(
                [
                    {
                        "ts_code": stock,
                        "period": pd.NA,
                        "fetch_http_status": r.status_code,
                        "fetch_error_detail": snippet,
                    }
                ]
            ),
            None,
        )

    err = body.get("error")
    if err:
        return (
            pd.DataFrame(
                [
                    {
                        "ts_code": stock,
                        "period": pd.NA,
                        "fetch_http_status": r.status_code,
                        "fetch_error_detail": str(err),
                    }
                ]
            ),
            None,
        )

    meta = body["metrics"] if isinstance(body.get("metrics"), dict) else None
    pts = body.get("points")
    if not isinstance(pts, list) or len(pts) == 0:
        return (
            pd.DataFrame([{"ts_code": stock, "period": pd.NA, "points_empty": True}]),
            meta,
        )

    df = pd.DataFrame(pts)
    if "period" not in df.columns:
        df.insert(0, "period", pd.NA)
    df.insert(0, "ts_code", stock)
    return df, meta


def fetch_batch_series(
    base_url: str,
    stocks: list[str],
    metrics: list[str],
    from_period: str | None,
    to_period: str | None,
    years: int | None,
    industry_growth_pct: float | None,
    max_workers: int,
    sleep_between_requests: float,
    metric_meta_accum: dict[str, Any],
) -> pd.DataFrame:
    """一批股票并行/串行拉 series"""

    parts: list[pd.DataFrame] = []
    meta_lock = threading.Lock()

    def ingest_meta(m: dict[str, Any] | None) -> None:
        if not m:
            return
        with meta_lock:
            if len(metric_meta_accum) == 0:
                metric_meta_accum.update(m)

    if max_workers <= 1:
        for stock in stocks:
            df, meta = fetch_one_stock_series(
                base_url,
                stock,
                metrics,
                from_period,
                to_period,
                years,
                industry_growth_pct,
            )
            ingest_meta(meta)
            parts.append(df)
            if sleep_between_requests > 0:
                time.sleep(sleep_between_requests)
    else:
        with ThreadPoolExecutor(max_workers=max_workers) as ex:
            futs = {
                ex.submit(
                    fetch_one_stock_series,
                    base_url,
                    s,
                    metrics,
                    from_period,
                    to_period,
                    years,
                    industry_growth_pct,
                ): s
                for s in stocks
            }
            for fut in as_completed(futs):
                df, meta = fut.result()
                ingest_meta(meta)
                parts.append(df)

    return pd.concat(parts, ignore_index=True) if parts else pd.DataFrame()


def parse_metric_source(args: argparse.Namespace) -> list[str]:
    if args.all_registry_metrics:
        path = Path(args.definitions_ts)
        if not path.is_file():
            raise SystemExit(f"找不到 definitions.ts: {path}")
        return parse_registry_metric_keys(path)
    mf = getattr(args, "metrics_file", None)
    if mf is not None:
        return load_metric_names_from_file(Path(mf))
    m = getattr(args, "metrics", None)
    if m:
        names = load_metric_names_from_arg(m)
        if not names:
            raise SystemExit("指标列表为空")
        return names
    raise SystemExit("未指定指标来源")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="导出全市场全期间 metrics 面板（pandas / parquet）")
    p.add_argument("--base-url", default=DEFAULT_BASE_URL)
    sg = p.add_mutually_exclusive_group(required=True)
    sg.add_argument("--from-stock-api", action="store_true")
    sg.add_argument("--codes-file", type=Path)
    sg.add_argument("--from-parquet", type=Path)
    p.add_argument("--stock-list-page-size", type=int, default=1000)
    mg = p.add_mutually_exclusive_group(required=True)
    mg.add_argument("--metrics", type=str, help="逗号或空格分隔的指标 id")
    mg.add_argument("--metrics-file", type=Path)
    mg.add_argument(
        "--all-registry-metrics",
        action="store_true",
        help="从 definitions.ts 自动解析全部注册指标键",
    )
    p.add_argument(
        "--definitions-ts",
        dest="definitions_ts",
        default=str(_DEFINITIONS_TS_DEFAULT),
        help="definitions.ts 路径（仅 --all-registry-metrics）",
    )
    p.add_argument("--from-period", dest="from_period", default=None, help="YYYYQx 起")
    p.add_argument("--to-period", dest="to_period", default=None, help="YYYYQx 止（含）")
    p.add_argument(
        "--years",
        type=int,
        default=None,
        help="传给 metrics 路由的 profit_growth 等用到的 years",
    )
    p.add_argument(
        "--industry-growth-pct",
        type=float,
        default=None,
        dest="industry_growth_pct",
        help="行业增速百分数（如 24 表示 24%%），dcf_equity_value_ttm_growth_ind 等需要",
    )
    p.add_argument(
        "--batch-size",
        type=int,
        default=30,
        help="每多少只股票为一批串联（减小内存尖峰）；批与批之间串行合并",
    )
    p.add_argument("--max-workers", type=int, default=3, help="每批股票内并发线程数（series 单次较重，勿过大）")
    p.add_argument("--sleep-request", type=float, default=0.0, help="串行模式下每笔请求间隔秒")
    p.add_argument("--sleep-batch", type=float, default=0.0, help="批次之间休眠")
    p.add_argument("--out", type=Path, default=Path("metrics_market_panel.parquet"))
    p.add_argument(
        "--format",
        choices=("parquet", "csv"),
        default="parquet",
        help="导出格式；parquet 需 pyarrow/fastparquet",
    )
    p.add_argument(
        "--out-metrics-meta",
        type=Path,
        default=None,
        help="将 API 返回的指标 label/unit 写入 JSON（取首次成功填充的累积）",
    )
    p.add_argument(
        "--limit-stocks",
        type=int,
        default=None,
        help="只处理前 N 只股票（在当前代码列表排序后截取，常用于试跑）",
    )
    p.add_argument(
        "--merge-stock-basic",
        action="store_true",
        help="再从 stockList 接口拉取名称/地域/行业等，按 ts_code 左连接到结果表",
    )
    return p.parse_args()


def main() -> None:
    args = parse_args()
    metrics = parse_metric_source(args)

    codes = load_ts_codes_from_stock_list_api(args.base_url, args.stock_list_page_size)
    if not codes:
        print("没有有效的 ts_code", file=sys.stderr)
        sys.exit(1)

    lim = getattr(args, "limit_stocks", None)
    if lim is not None:
        if lim <= 0:
            print("--limit-stocks 须为正整数", file=sys.stderr)
            sys.exit(1)
        codes = codes[:lim]

    print(
        f"股票 {len(codes)} 只，指标 {len(metrics)} 个，series 窗口 from={args.from_period!r} to={args.to_period!r}",
        file=sys.stderr,
    )

    metric_meta_accum: dict[str, Any] = {}
    pieces: list[pd.DataFrame] = []
    for bi, batch in enumerate(chunk_list(codes, args.batch_size)):
        print(f"[批次 {bi + 1}] {len(batch)} 只股票 …", file=sys.stderr)
        df_chunk = fetch_batch_series(
            args.base_url,
            batch,
            metrics,
            args.from_period,
            args.to_period,
            args.years,
            args.industry_growth_pct,
            args.max_workers,
            args.sleep_request,
            metric_meta_accum,
        )
        pieces.append(df_chunk)
        if args.sleep_batch > 0:
            time.sleep(args.sleep_batch)

    out_df = pd.concat(pieces, ignore_index=True)

    if getattr(args, "merge_stock_basic", False):
        out_df = enrich_panel_with_stock_basic(
            out_df, args.base_url, args.stock_list_page_size
        )

    fmt = args.format
    outp = Path(args.out)
    if fmt == "parquet":
        try:
            out_df.to_parquet(outp, index=False)
        except Exception as exc:
            print(f"写 parquet 失败（{exc}），改写 CSV", file=sys.stderr)
            outp = outp.with_suffix(".csv")
            out_df.to_csv(outp, index=False, encoding="utf-8-sig")
    else:
        out_df.to_csv(outp, index=False, encoding="utf-8-sig")

    print(f"已写入 {outp.resolve()} 行数={len(out_df)}", file=sys.stderr)

    if args.out_metrics_meta and metric_meta_accum:
        args.out_metrics_meta.write_text(
            json.dumps(metric_meta_accum, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(f"指标 meta 已写入 {args.out_metrics_meta.resolve()}", file=sys.stderr)


if __name__ == "__main__":
    main()
