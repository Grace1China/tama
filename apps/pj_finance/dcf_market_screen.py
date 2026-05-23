#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
全市场 DCF 低估初筛（两阶段）：通过 pj_finance 的 /api/metrics 拉取指标，用 pandas 合并与过滤。

重要说明（与当前 Next 接口行为一致）：
- 请求里若带 stocks= 多代码，服务端会走「行业聚合」，不会返回每只股票的拆分结果。
- 因此每只 ts_code 必须单独请求：`?stock=600000.SH&metrics=...`
- 「分批」= 按批次遍历股票列表，每批内并发/串行发多次 GET；不是一次 URL 塞进几百只股票。

股票代码全集：推荐 `--from-stock-api` 调用 GET `/api/csv/stockList`（与前端股票列表同源），不要用 daily_basic 等 parquet 当权威代码表。

口径：
- dcf_equity_value_ttm 为元人民币；total_mv 在数据层为「万元」，比较时需 total_mv * 10000 再与 DCF 比。
"""

from __future__ import annotations

import argparse
import sys
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Iterable

import pandas as pd
import requests

from metrics_pull_common import (
    DEFAULT_BASE_URL,
    METRICS_PATH,
    REQUEST_TIMEOUT_SEC,
    chunk_list,
    load_ts_codes_from_file,
    load_ts_codes_from_parquet,
    load_ts_codes_from_stock_list_api,
)

# ---------- 常量 ----------

# 阶段一：尽量少指标，减轻服务端 compute 负担
PHASE1_METRICS = ["dcf_equity_value_ttm", "total_mv", "fcff_ttm"]


def metrics_url(base: str, stock: str, metrics: list[str], period: str | None) -> str:
    from urllib.parse import urlencode

    q: dict[str, str] = {
        "stock": stock,
        "metrics": ",".join(metrics),
    }
    if period:
        q["period"] = period
    return f"{base.rstrip('/')}{METRICS_PATH}?{urlencode(q)}"


def fetch_one_stock(
    session: requests.Session | None,
    base_url: str,
    stock: str,
    metrics: list[str],
    period: str | None,
) -> dict[str, Any]:
    """单只股票单行结果（展开 results.value）；session 为空则本函数内自建（便于多线程隔离）"""
    sess = session or requests.Session()
    sess.headers.setdefault("Accept", "application/json")
    url = metrics_url(base_url, stock, metrics, period)
    r = sess.get(url, timeout=REQUEST_TIMEOUT_SEC)
    if not r.ok:
        return {
            "ts_code": stock,
            "error": f"http_{r.status_code}",
            "detail": r.text[:500],
        }
    body = r.json()
    if "error" in body:
        return {"ts_code": stock, "error": str(body.get("error")), "detail": body.get("message", "")}

    row: dict[str, Any] = {
        "ts_code": stock,
        "period": body.get("period"),
    }
    results = body.get("results") or {}
    for m in metrics:
        entry = results.get(m)
        val = entry.get("value") if isinstance(entry, dict) else None
        row[m] = val

    return row


def fetch_batch(
    base_url: str,
    stocks: list[str],
    metrics: list[str],
    period: str | None,
    max_workers: int,
    sleep_between_sec: float,
) -> pd.DataFrame:
    """一批股票：多线程 GET，返回 DataFrame"""
    rows: list[dict[str, Any]] = []

    if max_workers <= 1:
        session = requests.Session()
        session.headers.update({"Accept": "application/json"})
        for s in stocks:
            rows.append(fetch_one_stock(session, base_url, s, metrics, period))
            if sleep_between_sec > 0:
                time.sleep(sleep_between_sec)
    else:
        with ThreadPoolExecutor(max_workers=max_workers) as ex:
            futs = {
                # 并行时不传共享 Session，避免线程安全问题
                ex.submit(fetch_one_stock, None, base_url, s, metrics, period): s
                for s in stocks
            }
            for fut in as_completed(futs):
                rows.append(fut.result())

    df = pd.DataFrame(rows).sort_values("ts_code").reset_index(drop=True)
    return df


def add_dcf_comparison_columns(df: pd.DataFrame) -> pd.DataFrame:
    """DCF（元）与总市值（万元 -> 元）统一到元再比"""
    out = df.copy()
    if "dcf_equity_value_ttm" not in out.columns or "total_mv" not in out.columns:
        return out
    dcf_yuan = pd.to_numeric(out["dcf_equity_value_ttm"], errors="coerce")
    mv_wan = pd.to_numeric(out["total_mv"], errors="coerce")
    mv_yuan = mv_wan * 10_000.0
    out["total_mv_yuan_approx"] = mv_yuan
    out["dcf_mv_premium_pct"] = (dcf_yuan - mv_yuan) / mv_yuan
    valid = dcf_yuan.notna() & mv_yuan.notna() & (mv_yuan > 0)
    out["undervalued_dcf_vs_mv"] = valid & (dcf_yuan > mv_yuan)
    return out


def run_phase1(
    base_url: str,
    codes: list[str],
    batch_size: int,
    max_workers: int,
    sleep_between_requests: float,
    sleep_between_batches: float,
    period: str | None,
) -> pd.DataFrame:
    """阶段一：少指标全市场扫一遍"""
    parts: list[pd.DataFrame] = []
    for bi, batch in enumerate(chunk_list(codes, batch_size)):
        print(f"[阶段一] 批次 {bi + 1}，本批 {len(batch)} 只 …", file=sys.stderr)
        df = fetch_batch(
            base_url,
            batch,
            PHASE1_METRICS,
            period,
            max_workers=max_workers,
            sleep_between_sec=sleep_between_requests,
        )
        parts.append(df)
        if sleep_between_batches > 0:
            time.sleep(sleep_between_batches)
    merged = pd.concat(parts, ignore_index=True)
    return add_dcf_comparison_columns(merged)


def run_phase2(
    base_url: str,
    codes: list[str],
    metrics: list[str],
    batch_size: int,
    max_workers: int,
    sleep_between_requests: float,
    sleep_between_batches: float,
    period: str | None,
) -> pd.DataFrame:
    """阶段二：对初筛通过的股票拉扩展指标"""
    parts: list[pd.DataFrame] = []
    for bi, batch in enumerate(chunk_list(codes, batch_size)):
        print(f"[阶段二] 批次 {bi + 1}，本批 {len(batch)} 只 …", file=sys.stderr)
        df = fetch_batch(
            base_url,
            batch,
            metrics,
            period,
            max_workers=max_workers,
            sleep_between_sec=sleep_between_requests,
        )
        parts.append(df)
        if sleep_between_batches > 0:
            time.sleep(sleep_between_batches)
    return pd.concat(parts, ignore_index=True)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="全市场 DCF 初筛：按股票逐只请求 /api/metrics，pandas 合并",
    )
    p.add_argument(
        "--base-url",
        default=DEFAULT_BASE_URL,
        help="pj_finance 站点根 URL，默认 127.0.0.1:3000 或环境变量 PJ_FINANCE_METRICS_BASE_URL",
    )
    g = p.add_mutually_exclusive_group(required=True)
    g.add_argument(
        "--from-stock-api",
        action="store_true",
        help="从 GET /api/csv/stockList?page=&size= 拉取 ts_code（与股票列表页面同源，推荐）",
    )
    g.add_argument(
        "--codes-file",
        type=Path,
        help="股票列表文本：每行一只或逗号分隔",
    )
    g.add_argument(
        "--from-parquet",
        type=Path,
        help="备选：从 parquet 读 ts_code（非权威股票全集；宜用 --from-stock-api）",
    )
    p.add_argument(
        "--stock-list-page-size",
        type=int,
        default=1000,
        help="调用 stockList 时的 size 参数（仅 --from-stock-api 时生效；默认 1000）",
    )
    p.add_argument("--period", default=None, help="固定财报季 YYYYQx；不传则服务端用默认最新期")
    p.add_argument("--batch-size", type=int, default=100, help="每批股票数量（每批内仍是对每只股票单独 GET）")
    p.add_argument("--max-workers", type=int, default=4, help="每批内并发线程数，1=串行")
    p.add_argument("--sleep-request", type=float, default=0.0, help="串行模式下每请求间隔秒数")
    p.add_argument("--sleep-batch", type=float, default=0.0, help="批次之间休眠秒数")
    p.add_argument(
        "--out-phase1",
        type=Path,
        default=Path("dcf_screen_phase1.csv"),
        help="阶段一全量结果 CSV",
    )
    p.add_argument(
        "--phase2-metrics",
        default="",
        help="阶段二额外指标，逗号分隔；空则跳过阶段二",
    )
    p.add_argument(
        "--out-phase2",
        type=Path,
        default=Path("dcf_screen_phase2.csv"),
        help="阶段二结果 CSV",
    )
    p.add_argument(
        "--undervalued-only-phase2",
        action="store_true",
        help="仅对阶段一 undervalued_dcf_vs_mv==True 的股票跑阶段二",
    )
    return p.parse_args()


def main() -> None:
    args = parse_args()
    if args.from_stock_api:
        codes = load_ts_codes_from_stock_list_api(args.base_url, args.stock_list_page_size)
    elif args.from_parquet:
        codes = load_ts_codes_from_parquet(args.from_parquet)
    else:
        codes = load_ts_codes_from_file(args.codes_file)  # type: ignore[union-attr]

    if not codes:
        print("没有有效的 ts_code", file=sys.stderr)
        sys.exit(1)

    print(f"共 {len(codes)} 只股票，batch_size={args.batch_size} max_workers={args.max_workers}", file=sys.stderr)

    df1 = run_phase1(
        args.base_url,
        codes,
        args.batch_size,
        args.max_workers,
        args.sleep_request,
        args.sleep_batch,
        args.period,
    )
    df1.to_csv(args.out_phase1, index=False, encoding="utf-8-sig")
    print(f"[阶段一] 已写入 {args.out_phase1.resolve()}", file=sys.stderr)

    extra = [m.strip() for m in args.phase2_metrics.split(",") if m.strip()]
    if not extra:
        return

    if args.undervalued_only_phase2:
        if "undervalued_dcf_vs_mv" not in df1.columns:
            print("阶段一缺少 undervalued_dcf_vs_mv，无法 --undervalued-only-phase2", file=sys.stderr)
            sys.exit(1)
        sub = df1[df1["undervalued_dcf_vs_mv"].fillna(False)]
        picks = list(sub["ts_code"].astype(str))
    else:
        picks = list(df1["ts_code"].astype(str))

    if not picks:
        print("阶段二：无股票可拉", file=sys.stderr)
        return

    df2 = run_phase2(
        args.base_url,
        picks,
        extra,
        args.batch_size,
        args.max_workers,
        args.sleep_request,
        args.sleep_batch,
        args.period,
    )
    df2.to_csv(args.out_phase2, index=False, encoding="utf-8-sig")
    print(f"[阶段二] {len(picks)} 只股票，已写入 {args.out_phase2.resolve()}", file=sys.stderr)


if __name__ == "__main__":
    main()