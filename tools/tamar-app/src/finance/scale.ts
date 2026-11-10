import { metrics } from '../metrics/definitions.js';

export type ValueScale = 'ratio_0_1' | 'percent' | 'times' | 'yuan' | 'wan_yuan' | 'shares' | 'wan_shares';

/** 引擎里按除法得到的比率，数值在 0 到 1 附近，页面展示时再乘 100。 */
const RATIO_0_1 = new Set([
  'grossMargin',
  'grossMargin_ttm',
  'netMargin_ttm',
  'roe',
  'roe_dupont',
  'total_revenue_yoy',
  'dividend_ttm_rate',
]);

/** cagrPct 已经乘过 100，数值本身就是百分数。 */
const ALREADY_PERCENT = new Set([
  'mv_growth',
  'revenue_growth',
  'profit_growth',
  'net_assets_growth',
]);

const WAN_YUAN = new Set(['total_mv', 'dividend_ttm']);
const TIMES = new Set(['totalAsset_turnover_ttm', 'equity_multiplier_ttm']);

export type LabeledNumber = {
  value: number | null;
  unit: string | null;
  scale: ValueScale | null;
  label: string;
  /** ratio_0_1 的百分数展示值。value 本身仍是原比率，避免把 0.2 说成 0.2%。 */
  percent_value: number | null;
};

export function labelMetric(name: string, value: number | null): LabeledNumber {
  const meta = metrics[name]?.meta;
  const unit = meta?.unit ?? null;
  let scale: ValueScale | null = null;
  if (RATIO_0_1.has(name)) scale = 'ratio_0_1';
  else if (ALREADY_PERCENT.has(name) || unit === '%') scale = 'percent';
  else if (TIMES.has(name) || unit === 'times') scale = 'times';
  else if (WAN_YUAN.has(name)) scale = 'wan_yuan';
  else if (unit === 'CNY') scale = 'yuan';
  return {
    value,
    unit,
    scale,
    label: meta?.label ?? name,
    percent_value: scale === 'ratio_0_1' && value != null ? value * 100 : null,
  };
}

export function labelPercent(value: number | null, label: string): LabeledNumber {
  return { value, unit: '%', scale: 'percent', label, percent_value: value };
}

export function labelTimes(value: number | null, label: string): LabeledNumber {
  return { value, unit: 'times', scale: 'times', label, percent_value: null };
}

export function labelYuan(value: number | null, label: string, scale: 'yuan' | 'wan_yuan' = 'yuan'): LabeledNumber {
  return { value, unit: 'CNY', scale, label, percent_value: null };
}
