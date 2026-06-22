#!/usr/bin/env python3
"""Collect A-share call auction ticks with MyQuant and write JSON snapshots.

The script is intentionally standalone: it writes latest.json for the Next.js API
and appends every normalized tick to auction_snapshots.jsonl for later review.
"""

from __future__ import annotations

import argparse
import json
import os
import signal
import sys
import threading
from dataclasses import dataclass
from datetime import datetime, time as dtime
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional


ROOT = Path(__file__).resolve().parents[3]
AUCTION_DIR = ROOT / "apps" / "pj_finance" / "app" / "industryLink" / "auction"
LATEST_PATH = AUCTION_DIR / "latest.json"
JSONL_PATH = AUCTION_DIR / "auction_snapshots.jsonl"
DEFAULT_CODES_FILE = ROOT / "apps" / "pj_finance" / "app" / "industryLink" / "industry_company_ts_codes.yaml"


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Collect MyQuant call auction ticks.")
    p.add_argument("--codes", help="Comma-separated Tushare style codes, e.g. 300308.SZ,600519.SH")
    p.add_argument("--codes-file", default=str(DEFAULT_CODES_FILE), help="YAML mapping file containing ts_code values")
    p.add_argument("--output-dir", default=str(AUCTION_DIR), help="Directory for latest.json and auction_snapshots.jsonl")
    p.add_argument("--token", default=os.getenv("MYQUANT_TOKEN") or os.getenv("GM_TOKEN"), help="MyQuant token")
    p.add_argument("--allow-outside-window", action="store_true", help="Run even outside 09:15-09:25 for testing")
    p.add_argument("--max-codes", type=int, default=240, help="Safety cap for subscribed stocks")
    return p.parse_args()


def normalize_ts_code(code: str) -> Optional[str]:
    raw = str(code or "").strip().upper()
    if len(raw) != 9 or raw[6] != ".":
        return None
    if raw[:6].isdigit() and raw[7:] in {"SZ", "SH", "BJ"}:
        return raw
    return None


def ts_to_myquant_symbol(ts_code: str) -> str:
    code, exch = ts_code.split(".")
    # MyQuant uses exchange prefix style.
    prefix = {"SZ": "SZSE", "SH": "SHSE", "BJ": "BSE"}[exch]
    return f"{prefix}.{code}"


def myquant_to_ts_code(symbol: str) -> Optional[str]:
    raw = str(symbol or "").strip().upper()
    if "." not in raw:
        return None
    exch, code = raw.split(".", 1)
    suffix = {"SZSE": "SZ", "SHSE": "SH", "BSE": "BJ"}.get(exch)
    if suffix and code.isdigit() and len(code) == 6:
        return f"{code}.{suffix}"
    return normalize_ts_code(raw)


def read_codes_file(path: Path) -> List[str]:
    if not path.exists():
        return []
    out: List[str] = []
    for line in path.read_text("utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or ":" not in stripped:
            continue
        maybe = stripped.rsplit(":", 1)[-1].strip().strip("'\"")
        code = normalize_ts_code(maybe)
        if code:
            out.append(code)
    return out


def unique_codes(codes: Iterable[str], max_codes: int) -> List[str]:
    seen = set()
    out: List[str] = []
    for raw in codes:
        code = normalize_ts_code(raw)
        if not code or code in seen:
            continue
        seen.add(code)
        out.append(code)
        if len(out) >= max_codes:
            break
    return out


def is_auction_window(now: Optional[datetime] = None) -> bool:
    n = now or datetime.now()
    return dtime(9, 15) <= n.time() <= dtime(9, 25)


def seconds_until_auction_exit(now: Optional[datetime] = None) -> float:
    n = now or datetime.now()
    end = n.replace(hour=9, minute=25, second=30, microsecond=0)
    return max(0.0, (end - n).total_seconds())


def get_field(obj: Any, *names: str) -> Any:
    for name in names:
        if isinstance(obj, dict) and name in obj:
            return obj[name]
        if hasattr(obj, name):
            return getattr(obj, name)
    return None


def finite_or_none(value: Any) -> Optional[float]:
    try:
        n = float(value)
    except (TypeError, ValueError):
        return None
    if n != n or n in {float("inf"), float("-inf")}:
        return None
    return n


def normalize_tick(tick: Any) -> Optional[Dict[str, Any]]:
    symbol = get_field(tick, "symbol", "sec_id")
    ts_code = myquant_to_ts_code(str(symbol or ""))
    if not ts_code:
        return None

    created_at = datetime.now().isoformat(timespec="seconds")
    tick_time = get_field(tick, "created_at", "createdAt", "time", "trade_time", "tradeTime")
    last_price = finite_or_none(get_field(tick, "price", "last_price", "lastPrice", "last"))
    pre_close = finite_or_none(get_field(tick, "pre_close", "preClose", "last_close"))
    volume = finite_or_none(get_field(tick, "cum_volume", "cumVolume", "volume"))
    amount = finite_or_none(get_field(tick, "cum_amount", "cumAmount", "amount"))

    pct_chg = None
    if last_price is not None and pre_close not in (None, 0):
      pct_chg = (last_price / pre_close - 1) * 100

    return {
        "ts_code": ts_code,
        "symbol": str(symbol),
        "snapshot_at": str(tick_time or created_at),
        "received_at": created_at,
        "last_price": last_price,
        "pre_close": pre_close,
        "pct_chg": pct_chg,
        "volume": volume,
        "amount": amount,
        "source": "myquant",
        "status": classify_status(pct_chg, amount),
    }


def classify_status(pct_chg: Optional[float], amount: Optional[float]) -> str:
    if pct_chg is None:
        return "unknown"
    if pct_chg >= 3:
        return "strong_bid"
    if pct_chg >= 1:
        return "bid"
    if pct_chg <= -3:
        return "strong_pressure"
    if pct_chg <= -1:
        return "pressure"
    return "flat"


@dataclass
class Store:
    latest_path: Path
    jsonl_path: Path
    latest: Dict[str, Dict[str, Any]]

    @classmethod
    def open(cls, output_dir: Path) -> "Store":
        output_dir.mkdir(parents=True, exist_ok=True)
        latest_path = output_dir / "latest.json"
        jsonl_path = output_dir / "auction_snapshots.jsonl"
        latest: Dict[str, Dict[str, Any]] = {}
        if latest_path.exists():
            try:
                raw = json.loads(latest_path.read_text("utf-8"))
                if isinstance(raw, dict):
                    latest = {str(k): v for k, v in raw.items() if isinstance(v, dict)}
            except Exception:
                latest = {}
        return cls(latest_path=latest_path, jsonl_path=jsonl_path, latest=latest)

    def append(self, row: Dict[str, Any]) -> None:
        code = row["ts_code"]
        self.latest[code] = row
        with self.jsonl_path.open("a", encoding="utf-8") as f:
            f.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")
        tmp = self.latest_path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(self.latest, ensure_ascii=False, indent=2), "utf-8")
        tmp.replace(self.latest_path)


def main() -> int:
    args = parse_args()
    output_dir = Path(args.output_dir)
    cli_codes = args.codes.split(",") if args.codes else []
    file_codes = read_codes_file(Path(args.codes_file)) if not cli_codes else []
    codes = unique_codes(cli_codes or file_codes, args.max_codes)
    if not codes:
        print("No valid ts_codes found. Pass --codes or --codes-file.", file=sys.stderr)
        return 2
    if not args.allow_outside_window and not is_auction_window():
        print("Not in call auction window 09:15-09:25. Use --allow-outside-window for testing.", file=sys.stderr)
        return 2

    try:
        from gm.api import MODE_LIVE, set_token, subscribe, run  # type: ignore
    except Exception as exc:
        print("MyQuant gm.api is not installed or importable. Install/configure MyQuant Python SDK first.", file=sys.stderr)
        print(str(exc), file=sys.stderr)
        return 3

    if args.token:
        set_token(args.token)

    store = Store.open(output_dir)
    def handle_signal(_sig: int, _frame: Any) -> None:
        raise SystemExit(0)

    signal.signal(signal.SIGINT, handle_signal)
    signal.signal(signal.SIGTERM, handle_signal)

    def on_tick(context: Any, tick: Any) -> None:
        row = normalize_tick(tick)
        if not row:
            return
        store.append(row)
        print(json.dumps(row, ensure_ascii=False, separators=(",", ":")), flush=True)

    def init(context: Any) -> None:
        symbols = ",".join(ts_to_myquant_symbol(c) for c in codes)
        print(f"Subscribing {len(codes)} symbols with include_call_auction=True", flush=True)
        subscribe(symbols=symbols, frequency="tick", count=1, include_call_auction=True)

    globals()["init"] = init
    globals()["on_tick"] = on_tick

    if not args.allow_outside_window:
        delay = seconds_until_auction_exit()
        if delay <= 0:
            return 0

        def exit_after_window() -> None:
            print("Call auction window ended; exiting collector.", flush=True)
            os._exit(0)

        threading.Timer(delay, exit_after_window).start()

    # gm.api.run owns the event loop. For live mode it exits when the process receives SIGTERM/SIGINT.
    run(strategy_id="industry_link_auction_collector", filename=__file__, mode=MODE_LIVE)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
