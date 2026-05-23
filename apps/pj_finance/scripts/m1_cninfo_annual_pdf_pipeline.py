#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
M1：巨潮年报 PDF 小样本批量解析链路（试水版）

用法示例（在项目 apps/pj_finance 目录下执行，已设 TUSHARE_TOKEN）::

    cd apps/pj_finance
    python3 scripts/m1_cninfo_annual_pdf_pipeline.py --limit 50 --l1-name 通信 --sleep-cninfo 0.6

前置条件（任选其一生效）::
1) 环境变量 TUSHARE_TOKEN：通过 Tushare index_classify + index_member 拉取申万 2021 一级「通信」成分；
2) 本地 parquet：temp/tuShare/index_member_all.parquet（字段含 l1_name / ts_code，与站内 SW2021 成分源一致）。

输出::
- temp/m1_cninfo_manifest/manifest.csv   每只代码一条：标题、PDF 链接、本地路径、解析字符数等
- temp/m1_cninfo_manifest/summary.json   抽样统计（成功率、字数分布）
- temp/m1_cninfo_pdf/                    已下载 PDF（按 scode 分目录）

可选依赖::
    pip install requests pycryptodome pymupdf tushare duckdb pandas

说明::
- Accept-Enckey 算法与站内 ``lib/cninfo/fetchPInfo3085Server.ts`` 一致。
- PDF 正文抽取优先 pymupdf；若无则跳过文本仅保留清单与文件。
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import random
import re
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import requests

PJ_FIN_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUT_DIR = PJ_FIN_ROOT / "temp/m1_cninfo_pdf"
DEFAULT_MANIFEST_DIR = PJ_FIN_ROOT / "temp/m1_cninfo_manifest"
MEMBER_PQ = PJ_FIN_ROOT / "temp/tuShare/index_member_all.parquet"

BASE_CNINFO_API = "https://webapi.cninfo.com.cn"
SLATKEY_URL = f"{BASE_CNINFO_API}/api/mcode/slatkey"


def ts_code_to_scode(ts_code: str) -> str | None:
    s = str(ts_code).strip().upper()
    m = re.match(r"^(\d{6})\.(SZ|SH|BJ)$", s)
    if m:
        return m.group(1)
    digits = re.sub(r"\D", "", s)
    if len(digits) >= 6:
        return digits[:6]
    return None


def build_accept_enckey(slatkey: str) -> str:
    """与 Node AES-128-CBC(createCipheriv) 等价：plaintext 为秒级 UNIX 字符串，PKCS#7"""
    try:
        from Crypto.Cipher import AES  # noqa: PLR0402  # pycryptodome 包名为 Crypto
    except ImportError as e:
        raise SystemExit(
            "缺少依赖 pycryptodome（python3 -m pip install pycryptodome）以计算 Accept-Enckey"
        ) from e

    key = slatkey.encode("utf-8")
    iv = slatkey.encode("utf-8")
    if len(key) != 16 or len(iv) != 16:
        raise ValueError(f"slatkey 须为 UTF-8 恰好 16 字节，当前 {len(key)}")

    payload = str(int(time.time())).encode("utf-8")
    pad = 16 - (len(payload) % 16)
    payload = payload + bytes([pad] * pad)
    cipher = AES.new(key, AES.MODE_CBC, iv)
    encrypted = cipher.encrypt(payload)
    import base64

    return base64.b64encode(encrypted).decode("ascii")


def fetch_p_info3085(scode: str, sess: requests.Session) -> dict[str, Any]:
    """拉取巨潮 p_info3085 JSON"""
    r = sess.get(SLATKEY_URL, timeout=30)
    r.raise_for_status()
    slatkey = r.text.strip()
    if not slatkey:
        raise RuntimeError("slatkey 为空")
    accept_enckey = build_accept_enckey(slatkey)
    url = f"{BASE_CNINFO_API}/api/info/p_info3085"
    resp = sess.get(
        url,
        params={"scode": scode},
        headers={
            "Accept-Enckey": accept_enckey,
            "Referer": f"{BASE_CNINFO_API}/#/dataBrowse",
            "Origin": BASE_CNINFO_API,
            "X-Requested-With": "XMLHttpRequest",
            "Accept": "application/json, text/plain, */*",
            "User-Agent": "Mozilla/5.0",
        },
        timeout=120,
    )
    resp.raise_for_status()
    return resp.json()


def is_pdf_record(r: dict[str, Any]) -> bool:
    fmt = str(r.get("F004V", "")).upper()
    url = str(r.get("F003V", ""))
    return "PDF" in fmt and re.match(r"^https?://", url or "", re.I) is not None


def pick_latest_annual_report_pdf(records: list[dict[str, Any]]) -> dict[str, Any] | None:
    """
    选最新一条「中文年报全文」PDF：含年报关键词，尽量避免摘要/H 股/英文版。
    """
    annual_re = re.compile(r"(年报|年度报告)")
    exclude_re = re.compile(r"(摘要|英文版|English|英文报告|临时公告|风险提示|取消|作废|修订说明)")

    def sort_key(rec: dict[str, Any]) -> float:
        d = str(rec.get("F001D", "") or "").replace("/", "-")
        t = time.strptime(d[:10], "%Y-%m-%d") if len(d) >= 10 else time.gmtime(0)
        return time.mktime(t)

    cand: list[tuple[float, dict[str, Any]]] = []
    for rec in records:
        title = str(rec.get("F002V", "") or "").strip()
        if not annual_re.search(title):
            continue
        if exclude_re.search(title):
            continue
        if not is_pdf_record(rec):
            continue
        cand.append((sort_key(rec), rec))

    if not cand:
        return None
    cand.sort(key=lambda x: x[0], reverse=True)
    return cand[0][1]


def fetch_members_tushare(l1_name: str, limit: int) -> tuple[str | None, list[str]]:
    """返回 (resolved_index_like, ts_codes)，index 形如 801770.SI"""
    token = os.environ.get("TUSHARE_TOKEN", "").strip()
    if not token:
        raise RuntimeError("未设置 TUSHARE_TOKEN")

    try:
        import tushare as ts
    except ImportError as e:
        raise RuntimeError(
            "需要 pip install tushare（或改用本地 parquet 成分表）"
        ) from e

    ts.set_token(token)
    pro = ts.pro_api()
    clf = pro.index_classify(level="L1", src="SW2021")
    rows = clf[clf["industry_name"].astype(str).str.strip() == l1_name.strip()]
    if rows.empty:
        raise RuntimeError(f"申万 2021 L1 中未找到行业名：{l1_name}")
    index_code = str(rows.iloc[0]["index_code"]).strip()
    if not index_code.endswith(".SI"):
        index_code = f"{index_code}.SI"

    mem = pro.index_member(index_code=index_code)
    codes: list[str] = []
    for _, r in mem.iterrows():
        c = str(r.get("con_code") or r.get("ts_code") or "").strip().upper()
        if not re.match(r"^\d{6}\.(SZ|SH|BJ)$", c):
            continue
        codes.append(c)
    codes = sorted(set(codes))[:limit]
    return index_code, codes


def resolve_members_parquet_only(l1_name: str, limit: int) -> list[str]:
    if not MEMBER_PQ.exists():
        return []
    import duckdb

    mq = str(MEMBER_PQ.resolve()).replace("'", "''")
    qname = l1_name.replace("'", "''")
    try:
        rows = duckdb.sql(
            f"""
            SELECT DISTINCT trim(ts_code) AS tc
            FROM read_parquet('{mq}')
            WHERE (out_date IS NULL OR trim(cast(out_date AS VARCHAR)) = '')
              AND trim(l1_name) = '{qname}'
            ORDER BY tc
            LIMIT {int(limit)}
            """
        ).fetchall()
    except Exception:
        return []
    out: list[str] = []
    for (tc,) in rows:
        tc = str(tc).strip().upper()
        if re.match(r"^\d{6}\.(SZ|SH|BJ)$", tc):
            out.append(tc)
    return out


def pdf_text_char_count(path: Path) -> int | None:
    try:
        import fitz  # pymupdf
    except ImportError:
        return None
    try:
        doc = fitz.open(path)
        n = 0
        for i in range(doc.page_count):
            n += len(doc.load_page(i).get_text())
        doc.close()
        return n
    except Exception:
        return None


def safe_filename_piece(s: str, max_len: int = 80) -> str:
    s = re.sub(r"\s+", "_", s.strip())
    s = re.sub(r'[\\/:*?"<>|]', "", s)
    return (s[:max_len] if s else "untitled").rstrip(".")


def download_pdf(sess: requests.Session, url: str, dest: Path) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    # 站点常见防盗链校验
    h = {"Referer": "https://www.cninfo.com.cn/", "User-Agent": "Mozilla/5.0"}
    r = sess.get(url, headers=h, timeout=180, stream=True)
    r.raise_for_status()
    with open(dest, "wb") as f:
        for chunk in r.iter_content(chunk_size=65536):
            if chunk:
                f.write(chunk)


@dataclass
class ManifestRow:
    ts_code: str
    scode: str
    pick_title: str
    announce_date: str
    pdf_url: str
    local_pdf: str
    text_chars: str
    cninfo_rc: str
    err: str


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description="M1：巨潮年报 PDF 批量（申万样本）")
    ap.add_argument("--limit", type=int, default=50, help="最多处理只股票数（默认 50）")
    ap.add_argument("--l1-name", default="通信", help="申万 2021 一级行业中文名（默认 通信）")
    ap.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    ap.add_argument("--manifest-dir", type=Path, default=DEFAULT_MANIFEST_DIR)
    ap.add_argument("--dry-run", action="store_true", help="仅拉清单与选股，不落盘 PDF")
    ap.add_argument("--sleep-cninfo", type=float, default=0.55, help="两次巨潮 API 间隔秒（礼貌限速）")
    ap.add_argument(
        "--from-file",
        type=Path,
        default=None,
        help="已从外部准备好的 ts_code 列表文件（一行一只或逗号分隔），优先级高于板块拉取",
    )
    args = ap.parse_args(argv)

    out_dir: Path = args.out_dir
    man_dir: Path = args.manifest_dir
    man_dir.mkdir(parents=True, exist_ok=True)
    csv_path = man_dir / "manifest.csv"

    resolved_index: str | None = None
    ts_codes: list[str] = []

    if args.from_file and Path(args.from_file).exists():
        raw = Path(args.from_file).read_text(encoding="utf-8")
        for line in raw.splitlines():
            for part in line.replace("，", ",").split(","):
                p = part.strip().upper()
                if re.match(r"^\d{6}\.(SZ|SH|BJ)$", p):
                    ts_codes.append(p)
        ts_codes = sorted(set(ts_codes))[: args.limit]
        resolved_index = f"文件:{args.from_file.name}"
    else:
        ts_codes = resolve_members_parquet_only(args.l1_name, args.limit)
        if ts_codes:
            resolved_index = f"parquet:{MEMBER_PQ.relative_to(PJ_FIN_ROOT)}"
        else:
            try:
                resolved_index, ts_codes = fetch_members_tushare(args.l1_name, args.limit)
            except Exception as e:
                print(
                    f"[错误] 无法取得成分列表：{e}\n"
                    "  请先安装 tushare 并设置 TUSHARE_TOKEN；或补齐 temp/tuShare/index_member_all.parquet",
                    file=sys.stderr,
                )
                return 1

    summary: dict[str, Any] = {
        "universe": resolved_index or args.l1_name,
        "requested_limit": args.limit,
        "ts_codes_total": len(ts_codes),
        "dry_run": args.dry_run,
    }

    sess = requests.Session()
    manifest_rows: list[ManifestRow] = []

    print(f"# 样本数 {len(ts_codes)}，universe={resolved_index}")

    if not ts_codes:
        print("[错误] 样本列表为空（检查 parquet、tushare 或 --from-file）", file=sys.stderr)
        return 1

    last_call = 0.0

    def throttle():
        nonlocal last_call
        elapsed = time.time() - last_call
        gap = args.sleep_cninfo + random.uniform(0.05, 0.35)
        if elapsed < gap:
            time.sleep(gap - elapsed)
        last_call = time.time()

    for ti, ts_code in enumerate(ts_codes):
        scode = ts_code_to_scode(ts_code)
        mr = ManifestRow(
            ts_code=ts_code,
            scode=scode or "",
            pick_title="",
            announce_date="",
            pdf_url="",
            local_pdf="",
            text_chars="",
            cninfo_rc="",
            err="",
        )
        if not scode:
            mr.err = "无法解析 ts_code→scode"
            manifest_rows.append(mr)
            continue

        throttle()
        try:
            j = fetch_p_info3085(scode, sess)
        except Exception as e:
            mr.err = f"p_info3085: {e!s}"
            manifest_rows.append(mr)
            continue

        mr.cninfo_rc = str(j.get("resultcode", ""))
        rc = j.get("resultcode")
        if rc not in (None, 200, "200"):
            mr.err = str(j.get("resultmsg") or f"resultcode={rc}")
            manifest_rows.append(mr)
            continue

        recs_raw = j.get("records") or []
        records = list(recs_raw) if isinstance(recs_raw, list) else []
        picked = pick_latest_annual_report_pdf(records)
        if not picked:
            mr.err = "无匹配的年报全文 PDF（或仅有摘要/HTML）"
            manifest_rows.append(mr)
            continue

        mr.pick_title = str(picked.get("F002V", "") or "")
        mr.announce_date = str(picked.get("F001D", "") or "")
        mr.pdf_url = str(picked.get("F003V", "") or "")
        slug = hashlib.sha1((mr.pdf_url + mr.pick_title).encode("utf-8")).hexdigest()[:10]
        sub = Path(scode)
        fname = f"{slug}_{safe_filename_piece(mr.pick_title)}.pdf"
        dest = out_dir / sub / fname
        mr.local_pdf = str(dest.relative_to(PJ_FIN_ROOT))

        if not args.dry_run and mr.pdf_url:
            throttle()
            try:
                download_pdf(sess, mr.pdf_url, dest)
            except Exception as e:
                mr.err = f"download: {e!s}"

        if not mr.err and dest.exists():
            nch = pdf_text_char_count(dest)
            mr.text_chars = "" if nch is None else str(int(nch))

        manifest_rows.append(mr)
        ok = mr.err == ""
        print(f"[{ti+1}/{len(ts_codes)}] {ts_code} {'OK' if ok else mr.err}")

    fix_fields = ["ts_code", "scode", "pick_title", "announce_date", "pdf_url", "local_pdf", "text_chars", "cninfo_rc", "err"]

    with open(csv_path, "w", encoding="utf-8", newline="") as wf:
        w = csv.writer(wf)
        w.writerow(fix_fields)
        for mr in manifest_rows:
            w.writerow([getattr(mr, fld, "") for fld in fix_fields])

    ints = []
    for mr in manifest_rows:
        if mr.text_chars.isdigit():
            ints.append(int(mr.text_chars))
    summary["picked_pdf_ok"] = sum(1 for mr in manifest_rows if mr.pick_title)
    summary["download_ok"] = sum(1 for mr in manifest_rows if not mr.err and mr.local_pdf)
    summary["text_extracted_count"] = len(ints)
    summary["chars_median"] = float(sorted(ints)[len(ints) // 2]) if ints else None
    summary["chars_mean"] = (sum(ints) / len(ints)) if ints else None
    summary_error_count = sum(1 for mr in manifest_rows if mr.err)

    with open(man_dir / "summary.json", "w", encoding="utf-8") as sj:
        json.dump(summary, sj, ensure_ascii=False, indent=2)

    print(f"# 写入 {csv_path}，错误条数 {summary_error_count}")

    analysis_md_path = man_dir / "quick_analysis_note.txt"

    analysis_md_path.write_text(
        f"""quick_analysis_note（自动生成）
样本：申万一级「{args.l1_name}」最多 {args.limit} 只
解析成功写入 PDF（无 err）：{summary['download_ok']}
抽取正文（pymupdf 字符数非空）：{summary['text_extracted_count']}
median_chars：{summary['chars_median']}
mean_chars：{round(summary['chars_mean'], 0) if summary['chars_mean'] else None}

后续可做：正则抽「公司业务概要」「主要产品」首节；或送进 LLM 做产业链标签（与前端 industryLink 占位节点对齐）。
""",
        encoding="utf-8",
    )

    return 0 if summary_error_count < len(manifest_rows) else 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
