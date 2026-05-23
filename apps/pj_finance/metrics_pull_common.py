# -*- coding: utf-8 -*-
"""
股票列表加载与批处理工具（dcf_market_screen / metrics_market_panel 共用）。
"""
from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any, Iterable

import requests

DEFAULT_BASE_URL = os.environ.get("PJ_FINANCE_METRICS_BASE_URL", "http://127.0.0.1:3000")
METRICS_PATH = "/api/metrics"

STOCKLIST_PATH = "/api/csv/stockList"
REQUEST_TIMEOUT_SEC = float(os.environ.get("DCF_SCREEN_REQUEST_TIMEOUT", "120"))
STOCKLIST_TIMEOUT_SEC = float(os.environ.get("DCF_SCREEN_STOCKLIST_TIMEOUT", "300"))

_TS_CODE_RE = re.compile(r"^\d{6}\.(SZ|SH|BJ)$")


def normalize_ts_code(s: str) -> str | None:
    s = str(s).strip().upper()
    if _TS_CODE_RE.match(s):
        return s
    return None


def chunk_list(xs: list[str], size: int) -> Iterable[list[str]]:
    for i in range(0, len(xs), size):
        yield xs[i : i + size]


def load_ts_codes_from_file(path: Path) -> list[str]:
    """每行一只股票代码，或使用逗号分隔；自动去重"""
    raw = path.read_text(encoding="utf-8")
    codes: list[str] = []
    for line in raw.splitlines():
        for part in line.replace("，", ",").split(","):
            c = normalize_ts_code(part)
            if c:
                codes.append(c)
    return sorted(set(codes))


def load_ts_codes_from_parquet(path: Path, column: str = "ts_code") -> list[str]:
    """从 parquet 读取不重复 ts_code（备选；全市场请以 stockList 接口为准）"""
    import pandas as pd

    df = pd.read_parquet(path, columns=[column])
    s = df[column].astype(str).str.strip().str.upper()
    return sorted({x for x in s if normalize_ts_code(x)})


def fetch_stock_list_all_rows(base_url: str, page_size: int) -> list[dict[str, Any]]:
    """
    GET `/api/csv/stockList?page=&size=`，返回原始行字典列表（分页语义与旧版加载器一致）。
    """
    sess = requests.Session()
    sess.headers.setdefault("Accept", "application/json")
    accumulated: list[dict[str, Any]] = []
    base = base_url.rstrip("/")
    page = 1
    declared_total: int | None = None

    while True:
        list_url = f"{base}{STOCKLIST_PATH}?page={page}&size={page_size}"
        r = sess.get(list_url, timeout=STOCKLIST_TIMEOUT_SEC)
        r.raise_for_status()
        body = r.json()

        err = body.get("error")
        if err:
            raise RuntimeError(f"stockList API: {err}")

        if body.get("totalRows") is not None:
            try:
                declared_total = int(body["totalRows"])
            except (TypeError, ValueError):
                declared_total = None

        data = body.get("data") or []
        if not isinstance(data, list):
            raise RuntimeError("stockList API: response.data 不是列表")

        for row in data:
            if isinstance(row, dict):
                accumulated.append(row)

        if len(data) > page_size:
            break
        if len(data) == 0:
            break
        if declared_total is not None and len(accumulated) >= declared_total:
            break
        if len(data) < page_size:
            break
        page += 1

    return accumulated


def load_ts_codes_from_stock_list_api(base_url: str, page_size: int) -> list[str]:
    """GET `/api/csv/stockList`，提取有效 ts_code 并排序去重"""
    rows = fetch_stock_list_all_rows(base_url, page_size)
    codes = [normalize_ts_code(str(r.get("ts_code", ""))) for r in rows]
    return sorted({c for c in codes if c})
