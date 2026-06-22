'use client';

import { useEffect, useState } from 'react';

export type SwIndexReturns = {
  d1: number | null;
  d5: number | null;
  d20: number | null;
};

export type SwIndexSnapshot = {
  ts_code: string;
  trade_date: string;
  close: number | null;
  returns: SwIndexReturns;
};

/** 涨跌幅展示（A 股红涨绿跌） */
export function formatSwChgPct(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return '—';
  const sign = v > 0 ? '+' : '';
  return `${sign}${v.toFixed(2)}%`;
}

export function swChgClass(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return 'text-gray-400';
  if (v > 0) return 'text-red-600';
  if (v < 0) return 'text-green-600';
  return 'text-gray-500';
}

/** 申万指数树行内列宽 */
export const SW_TREE_ROW_COLS =
  'grid grid-cols-[minmax(0,1fr)_74px_44px_44px_48px_34px] items-center gap-x-1';

export function useSwIndexPriceSnapshots() {
  const [snapshots, setSnapshots] = useState<Map<string, SwIndexSnapshot>>(new Map());
  const [loading, setLoading] = useState(true);
  const [tradeDate, setTradeDate] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch('/api/parq/sw2021/price-snapshots')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then((json) => {
        if (cancelled) return;
        const rows = Array.isArray(json?.rows) ? (json.rows as SwIndexSnapshot[]) : [];
        const next = new Map<string, SwIndexSnapshot>();
        for (const row of rows) {
          const code = String(row.ts_code ?? '').trim().toUpperCase();
          if (code) next.set(code, row);
        }
        setSnapshots(next);
        setTradeDate(rows[0]?.trade_date ?? null);
      })
      .catch(() => {
        if (!cancelled) {
          setSnapshots(new Map());
          setTradeDate(null);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { snapshots, loading, tradeDate };
}
