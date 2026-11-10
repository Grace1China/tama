import { dateDigits, expectedLastSession, nowCst } from './time.js';

export type Freshness = {
  as_of: string | null;
  as_of_source: string;
  queried_at: string;
  stale: boolean;
  missing: boolean;
  note: string | null;
};

/**
 * 行情结果：as_of 早于预期最近交易日则 stale，禁止把更早的收盘说成今日收盘。
 * 财报结果传入 compareToSession=false：报告期本身早于交易日不算行情过期，空结果或文件缺失才是 missing。
 */
export function freshness(opts: {
  asOf: string | null | undefined;
  source: string;
  nowMs?: number;
  missing?: boolean;
  compareToSession?: boolean;
}): Freshness {
  const nowMs = opts.nowMs ?? Date.now();
  const asOf = dateDigits(opts.asOf) || null;
  const missing = opts.missing !== undefined ? opts.missing : !asOf;
  const expected = expectedLastSession(nowMs);
  const compare = opts.compareToSession !== false;
  const stale = !missing && compare && !!asOf && asOf < expected;
  let note: string | null = null;
  if (missing) note = '没有可用记录或源文件不存在，不能当成最新数据。';
  else if (stale) note = `as_of ${asOf} 早于预期最近交易日 ${expected}，不是今日收盘。`;
  return {
    as_of: asOf,
    as_of_source: opts.source,
    queried_at: nowCst(nowMs),
    stale,
    missing,
    note,
  };
}
