export type BfqBar = {
  ts_code: string;
  trade_date: string;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  pre_close: number | null;
  change: number | null;
  pct_chg: number | null;
  vol: number | null;
  amount: number | null;
};

export type AdjFactor = {
  ts_code: string;
  trade_date: string;
  adj_factor: number | null;
};

export type QfqBar = BfqBar & {
  adj_factor: number | null;
  latest_adj: number | null;
};

function num(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** 不复权价 × 当日复权因子 / 该股最新复权因子。因子来自 ASOF，不用 qfqDir。 */
export function applyQfq(value: number | null, adjFactor: number | null, latestAdj: number | null): number | null {
  if (value == null || adjFactor == null || latestAdj == null || latestAdj === 0) return null;
  return (value * adjFactor) / latestAdj;
}

/**
 * ASOF：取 trade_date 不晚于行情日的最近一条复权因子。
 * latestAdj 是该股复权因子表里 trade_date 最大的那条，即使它晚于行情日。
 */
export function joinQfq(bars: BfqBar[], factors: AdjFactor[]): QfqBar[] {
  const byCode = new Map<string, AdjFactor[]>();
  for (const factor of factors) {
    const code = factor.ts_code.toUpperCase();
    const list = byCode.get(code) ?? [];
    list.push(factor);
    byCode.set(code, list);
  }
  for (const list of byCode.values()) {
    list.sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  }

  return bars.map((bar) => {
    const code = bar.ts_code.toUpperCase();
    const list = byCode.get(code) ?? [];
    const latest = list.length ? list[list.length - 1] : null;
    let chosen: AdjFactor | null = null;
    for (const factor of list) {
      if (factor.trade_date <= bar.trade_date) chosen = factor;
      else break;
    }
    const adj = num(chosen?.adj_factor);
    const latestAdj = num(latest?.adj_factor);
    return {
      ...bar,
      ts_code: code,
      open: applyQfq(bar.open, adj, latestAdj),
      high: applyQfq(bar.high, adj, latestAdj),
      low: applyQfq(bar.low, adj, latestAdj),
      close: applyQfq(bar.close, adj, latestAdj),
      pre_close: applyQfq(bar.pre_close, adj, latestAdj),
      change: applyQfq(bar.change, adj, latestAdj),
      adj_factor: adj,
      latest_adj: latestAdj,
    };
  });
}
