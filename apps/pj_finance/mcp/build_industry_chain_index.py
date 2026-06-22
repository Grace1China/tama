#!/usr/bin/env python3
"""Build a research-grade industry-chain price index and write one parquet file."""

from __future__ import annotations

import argparse
import json
import math
import os
from pathlib import Path
from typing import Any

import pandas as pd


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--taxonomy-id", required=True)
    parser.add_argument("--taxonomy-label", required=True)
    parser.add_argument("--members-json", required=True)
    parser.add_argument("--start-date", required=True)
    parser.add_argument("--end-date", required=True)
    parser.add_argument(
        "--weight-method",
        choices=("equal", "float_mv", "capped_float_mv", "chain_balanced", "manual"),
        default="chain_balanced",
    )
    parser.add_argument("--max-weight", type=float, default=0.10)
    parser.add_argument("--base-value", type=float, default=1000.0)
    parser.add_argument("--output", required=True)
    parser.add_argument("--price-parquet")
    parser.add_argument("--market-cap-parquet")
    return parser.parse_args()


def normalize_date(value: str) -> str:
    digits = "".join(ch for ch in value if ch.isdigit())
    if len(digits) != 8:
        raise ValueError(f"date must be YYYYMMDD: {value}")
    return digits


def load_members(path: Path) -> pd.DataFrame:
    rows = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(rows, list) or not rows:
        raise ValueError("members-json must contain a non-empty JSON array")
    df = pd.DataFrame(rows)
    required = {"company_name", "ts_code", "stage", "sub_track"}
    missing = required - set(df.columns)
    if missing:
        raise ValueError(f"members-json missing fields: {sorted(missing)}")
    df["ts_code"] = df["ts_code"].astype(str).str.upper().str.strip()
    df["company_name"] = df["company_name"].astype(str).str.strip()
    df["stage"] = df["stage"].astype(str).str.strip()
    df["sub_track"] = df["sub_track"].astype(str).str.strip()
    df["purity_score"] = pd.to_numeric(df.get("purity_score", 1.0), errors="coerce").fillna(1.0)
    df["purity_score"] = df["purity_score"].clip(lower=0.0, upper=1.0)
    df["manual_weight"] = pd.to_numeric(df.get("manual_weight"), errors="coerce")
    df = df[df["ts_code"].str.match(r"^\d{6}\.(SZ|SH|BJ)$", na=False)]
    return df.drop_duplicates("ts_code", keep="first").reset_index(drop=True)


def normalize_price_frame(raw: pd.DataFrame) -> pd.DataFrame:
    required = {"ts_code", "trade_date", "close"}
    missing = required - set(raw.columns)
    if missing:
        raise ValueError(f"price data missing fields: {sorted(missing)}")
    df = raw[list(required)].copy()
    df["ts_code"] = df["ts_code"].astype(str).str.upper().str.strip()
    df["trade_date"] = (
        df["trade_date"].astype(str).str.replace(r"\D", "", regex=True).str.slice(0, 8)
    )
    df["close"] = pd.to_numeric(df["close"], errors="coerce")
    return (
        df.dropna(subset=["close"])
        .drop_duplicates(["trade_date", "ts_code"], keep="last")
        .sort_values(["trade_date", "ts_code"])
    )


def fetch_tushare_prices(codes: list[str], start_date: str, end_date: str) -> pd.DataFrame:
    if not os.getenv("TUSHARE_TOKEN"):
        raise RuntimeError("TUSHARE_TOKEN is required when price-parquet is not provided")
    import tushare as ts

    parts: list[pd.DataFrame] = []
    failures: list[str] = []
    for code in codes:
        try:
            frame = ts.pro_bar(
                ts_code=code,
                start_date=start_date,
                end_date=end_date,
                adj="qfq",
                factors=None,
            )
        except Exception:
            failures.append(code)
            continue
        if frame is None or frame.empty:
            failures.append(code)
            continue
        parts.append(frame[["ts_code", "trade_date", "close"]])
    if not parts:
        raise RuntimeError(f"no price data returned; failed members: {failures}")
    return normalize_price_frame(pd.concat(parts, ignore_index=True))


def load_price_data(
    members: pd.DataFrame,
    start_date: str,
    end_date: str,
    price_parquet: str | None,
) -> pd.DataFrame:
    if price_parquet:
        raw = pd.read_parquet(price_parquet)
        prices = normalize_price_frame(raw)
    else:
        prices = fetch_tushare_prices(members["ts_code"].tolist(), start_date, end_date)
    return prices[
        prices["ts_code"].isin(members["ts_code"])
        & prices["trade_date"].between(start_date, end_date)
    ].copy()


def latest_float_mv_from_frame(raw: pd.DataFrame, codes: list[str], as_of: str) -> pd.Series:
    if "circ_mv" not in raw.columns:
        raise ValueError("market-cap data missing circ_mv")
    df = raw.copy()
    if "trade_date" not in df.columns or "ts_code" not in df.columns:
        raise ValueError("market-cap data requires ts_code and trade_date")
    df["ts_code"] = df["ts_code"].astype(str).str.upper().str.strip()
    df["trade_date"] = (
        df["trade_date"].astype(str).str.replace(r"\D", "", regex=True).str.slice(0, 8)
    )
    df["circ_mv"] = pd.to_numeric(df["circ_mv"], errors="coerce")
    df = df[df["ts_code"].isin(codes) & (df["trade_date"] <= as_of)]
    latest = df.sort_values("trade_date").drop_duplicates("ts_code", keep="last")
    return latest.set_index("ts_code")["circ_mv"]


def fetch_tushare_float_mv(codes: list[str], as_of: str) -> pd.Series:
    import tushare as ts

    pro = ts.pro_api(os.getenv("TUSHARE_TOKEN"))
    rows = pro.daily_basic(trade_date=as_of, fields="ts_code,trade_date,circ_mv")
    if rows is None or rows.empty:
        return pd.Series(dtype=float)
    return latest_float_mv_from_frame(rows, codes, as_of)


def cap_weights(raw: pd.Series, cap: float) -> pd.Series:
    weights = raw.clip(lower=0).astype(float)
    if weights.sum() <= 0:
        weights[:] = 1.0
    weights /= weights.sum()
    if cap <= 0 or cap >= 1:
        return weights
    # A 10% cap is impossible for fewer than ten constituents. In that case,
    # use the tightest feasible cap and retain a valid fully invested index.
    cap = max(cap, 1.0 / len(weights))
    for _ in range(len(weights) + 2):
        over = weights > cap + 1e-12
        if not over.any():
            break
        excess = float((weights[over] - cap).sum())
        weights.loc[over] = cap
        under = ~over
        room = cap - weights[under]
        if room.sum() <= 0:
            break
        allocation = weights[under].clip(lower=0)
        if allocation.sum() <= 0:
            allocation[:] = 1.0
        allocation /= allocation.sum()
        weights.loc[under] += excess * allocation
    return weights / weights.sum()


def compute_weights(
    members: pd.DataFrame,
    method: str,
    max_weight: float,
    as_of: str,
    market_cap_parquet: str | None,
) -> pd.Series:
    indexed = members.set_index("ts_code")
    purity = indexed["purity_score"].clip(lower=0.0)
    if method == "manual":
        raw = indexed["manual_weight"].fillna(0.0)
        if raw.sum() <= 0:
            raise ValueError("manual weight method requires positive manual_weight values")
        return raw / raw.sum()
    if method == "equal":
        return cap_weights(pd.Series(1.0, index=indexed.index), max_weight)

    if market_cap_parquet:
        float_mv = latest_float_mv_from_frame(
            pd.read_parquet(market_cap_parquet), indexed.index.tolist(), as_of
        )
    else:
        float_mv = fetch_tushare_float_mv(indexed.index.tolist(), as_of)
    float_mv = float_mv.reindex(indexed.index).fillna(0.0).clip(lower=0.0)
    if float_mv.sum() <= 0:
        float_mv[:] = 1.0

    if method in {"float_mv", "capped_float_mv"}:
        raw = float_mv * purity.where(purity > 0, 0.0)
        cap = 1.0 if method == "float_mv" else max_weight
        return cap_weights(raw, cap)

    # Equal budget by sub-track; within each sub-track use sqrt(float market cap) × purity.
    group_key = indexed["stage"] + " / " + indexed["sub_track"]
    raw = pd.Series(0.0, index=indexed.index)
    groups = sorted(group_key.unique())
    for group in groups:
        group_codes = group_key[group_key == group].index
        group_raw = float_mv.loc[group_codes].pow(0.5) * purity.loc[group_codes]
        if group_raw.sum() <= 0:
            group_raw[:] = 1.0
        raw.loc[group_codes] = group_raw / group_raw.sum() / len(groups)
    return cap_weights(raw, max_weight)


def build_index(
    taxonomy_id: str,
    taxonomy_label: str,
    members: pd.DataFrame,
    prices: pd.DataFrame,
    method: str,
    max_weight: float,
    base_value: float,
    market_cap_parquet: str | None,
) -> tuple[pd.DataFrame, dict[str, Any]]:
    matrix = prices.pivot(index="trade_date", columns="ts_code", values="close").sort_index()
    if matrix.empty:
        raise ValueError("no price rows in requested date range")
    first_valid_date = str(matrix.index.min())
    active_codes = [
        code for code in members["ts_code"] if code in matrix.columns and pd.notna(matrix.loc[first_valid_date, code])
    ]
    if not active_codes:
        first_valid_date = str(matrix.dropna(how="all").index.min())
        active_codes = [
            code
            for code in members["ts_code"]
            if code in matrix.columns and pd.notna(matrix.loc[first_valid_date, code])
        ]
    if not active_codes:
        raise ValueError("no constituent has a valid price on the base date")

    active = members[members["ts_code"].isin(active_codes)].copy()
    weights = compute_weights(active, method, max_weight, first_valid_date, market_cap_parquet)
    matrix = matrix[active_codes].loc[first_valid_date:].ffill()
    normalized = matrix.divide(matrix.iloc[0])
    weighted = normalized.mul(weights.reindex(active_codes), axis=1)
    levels = weighted.sum(axis=1) * base_value
    coverage = matrix.notna().mul(weights.reindex(active_codes), axis=1).sum(axis=1)

    index_rows = pd.DataFrame(
        {
            "record_type": "index",
            "taxonomy_id": taxonomy_id,
            "taxonomy_label": taxonomy_label,
            "trade_date": levels.index.astype(str),
            "index_level": levels.round(6).values,
            "daily_return": levels.pct_change().fillna(0.0).round(10).values,
            "weight_method": method,
            "base_date": first_valid_date,
            "base_value": float(base_value),
            "coverage_weight": coverage.round(8).values,
            "constituent_count": len(active_codes),
        }
    )
    constituent_rows = active.copy()
    constituent_rows["record_type"] = "constituent"
    constituent_rows["taxonomy_id"] = taxonomy_id
    constituent_rows["taxonomy_label"] = taxonomy_label
    constituent_rows["trade_date"] = first_valid_date
    constituent_rows["index_level"] = math.nan
    constituent_rows["daily_return"] = math.nan
    constituent_rows["weight_method"] = method
    constituent_rows["base_date"] = first_valid_date
    constituent_rows["base_value"] = float(base_value)
    constituent_rows["coverage_weight"] = math.nan
    constituent_rows["constituent_count"] = len(active_codes)
    constituent_rows["weight"] = constituent_rows["ts_code"].map(weights).astype(float)

    all_columns = sorted(set(index_rows.columns) | set(constituent_rows.columns))
    output = pd.concat(
        [index_rows.reindex(columns=all_columns), constituent_rows.reindex(columns=all_columns)],
        ignore_index=True,
    )
    meta = {
        "base_date": first_valid_date,
        "end_date": str(levels.index.max()),
        "index_rows": len(index_rows),
        "constituent_count": len(active_codes),
        "excluded_no_base_price": sorted(set(members["ts_code"]) - set(active_codes)),
        "latest_index_level": float(levels.iloc[-1]),
    }
    return output, meta


def main() -> None:
    args = parse_args()
    start_date = normalize_date(args.start_date)
    end_date = normalize_date(args.end_date)
    if start_date > end_date:
        raise ValueError("start-date must be <= end-date")
    if not (0 < args.base_value):
        raise ValueError("base-value must be positive")

    members = load_members(Path(args.members_json))
    prices = load_price_data(members, start_date, end_date, args.price_parquet)
    output, meta = build_index(
        args.taxonomy_id,
        args.taxonomy_label,
        members,
        prices,
        args.weight_method,
        args.max_weight,
        args.base_value,
        args.market_cap_parquet,
    )
    output_path = Path(args.output).expanduser().resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output.to_parquet(output_path, index=False)
    meta.update(
        {
            "output_path": str(output_path),
            "row_count": len(output),
            "columns": output.columns.tolist(),
            "price_source": args.price_parquet or "tushare.pro_bar(adj=qfq)",
            "market_cap_source": args.market_cap_parquet or "tushare.daily_basic(circ_mv)",
        }
    )
    print(json.dumps(meta, ensure_ascii=False))


if __name__ == "__main__":
    main()
