export type JoinedPriceBar = {
  ts_code: string;
  trade_date: string;
  close: number | null;
  pre_close: number | null;
  pct_chg: number | null;
};

export type PriceSnapshot = {
  ts_code: string;
  trade_date: string;
  close: number | null;
  d1: number | null;
  d5: number | null;
  d20: number | null;
  d60: number | null;
  /** d1 优先用不复权 pct_chg；5/20/60 是交易日偏移后的前复权涨跌幅，单位为百分数。 */
  d1_source: 'pct_chg' | 'pre_close' | 'prior_close' | null;
  unit: '%';
  scale: 'percent';
};

function finite(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) ? value : null;
}

function ret(latest: number, past: number | null): number | null {
  if (past == null || past === 0 || !Number.isFinite(latest)) return null;
  return (latest / past - 1) * 100;
}

/**
 * 与 industryPriceSnapshots 同一口径：
 * 按交易日倒序，rn=1 为最新；d5 用 rn=6，d20 用 rn=21，d60 用 rn=61。
 * d1 优先 bfq.pct_chg，其次前复权 pre_close，再次前一交易日收盘。
 */
export function priceSnapshotsFromBars(bars: JoinedPriceBar[]): PriceSnapshot[] {
  const grouped = new Map<string, JoinedPriceBar[]>();
  for (const bar of bars) {
    if (bar.close == null || !Number.isFinite(bar.close)) continue;
    const code = bar.ts_code.toUpperCase();
    const list = grouped.get(code) ?? [];
    list.push({ ...bar, ts_code: code });
    grouped.set(code, list);
  }
  const out: PriceSnapshot[] = [];
  for (const [code, list] of grouped) {
    list.sort((a, b) => b.trade_date.localeCompare(a.trade_date));
    const latest = list[0];
    const close = finite(latest.close);
    if (close == null) continue;
    const closeAt = (rn: number) => finite(list[rn - 1]?.close ?? null);
    const pct = finite(latest.pct_chg);
    const pre = finite(latest.pre_close);
    let d1: number | null = null;
    let d1Source: PriceSnapshot['d1_source'] = null;
    if (pct != null) {
      d1 = pct;
      d1Source = 'pct_chg';
    } else if (pre != null && pre !== 0) {
      d1 = (close / pre - 1) * 100;
      d1Source = 'pre_close';
    } else {
      const prior = closeAt(2);
      if (prior != null && prior !== 0) {
        d1 = (close / prior - 1) * 100;
        d1Source = 'prior_close';
      }
    }
    out.push({
      ts_code: code,
      trade_date: latest.trade_date,
      close,
      d1,
      d5: ret(close, closeAt(6)),
      d20: ret(close, closeAt(21)),
      d60: ret(close, closeAt(61)),
      d1_source: d1Source,
      unit: '%',
      scale: 'percent',
    });
  }
  out.sort((a, b) => a.ts_code.localeCompare(b.ts_code));
  return out;
}

export type Kline60 = {
  price_multiple: number | null;
  odds_60: number | null;
  high: number | null;
  low: number | null;
  bars: number;
  unit: 'times';
  scale: 'ratio';
};

/** 价倍比 = 60 日最高 / 最低；60 日赔率 = (最高 - 现价) / (现价 - 最低)。 */
export function kline60Metrics(
  bars: Array<{ high: number | null; low: number | null; close: number | null }>,
  currentClose: number | null,
): Kline60 {
  const ordered = bars.filter((bar) => bar.high != null || bar.low != null);
  const window = ordered.length > 60 ? ordered.slice(-60) : ordered;
  let high = -Infinity;
  let low = Infinity;
  for (const bar of window) {
    if (bar.high != null && Number.isFinite(bar.high) && bar.high > high) high = bar.high;
    if (bar.low != null && Number.isFinite(bar.low) && bar.low < low) low = bar.low;
  }
  if (!window.length || !Number.isFinite(high) || !Number.isFinite(low) || low <= 0) {
    return { price_multiple: null, odds_60: null, high: null, low: null, bars: window.length, unit: 'times', scale: 'ratio' };
  }
  const price = currentClose != null && Number.isFinite(currentClose) ? currentClose : window[window.length - 1]?.close;
  let odds: number | null = null;
  if (price != null && Number.isFinite(price)) {
    const upRoom = high - price;
    const downRoom = price - low;
    if (downRoom > 0) odds = upRoom / downRoom;
    else if (upRoom <= 0) odds = 0;
    else odds = null;
  }
  return {
    price_multiple: high / low,
    odds_60: odds,
    high,
    low,
    bars: window.length,
    unit: 'times',
    scale: 'ratio',
  };
}
