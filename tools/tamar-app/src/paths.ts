import fs from 'node:fs';
import type { AppConfig } from './config.js';
import { resolveInsideRoot, SafeError } from './safety.js';

/**
 * 数据根内的相对路径。行情前复权只读 bfqDir + adjFactor，不把 qfqDir.parquet 当价格源。
 * daily_basic 按页面顺序先看 ss，不存在再用全量。
 */
export const RELATIVE_FILES = {
  bfq: ['tuShare/bfqDir.parquet'],
  adj: ['tuShare/adjFactor.parquet', 'tuShare/adjFactor_ss.parquet'],
  dailyBasic: ['tuShare/daily_basic_ss.parquet', 'tuShare/daily_basic.parquet'],
  income: ['tuShare/income_vip_ss.parquet'],
  balance: ['tuShare/balancesheet_vip_ss.parquet', 'tuShare/balanceSheet_vip.parquet'],
  cashflow: ['tuShare/cashflow_vip_ss.parquet'],
  finaIndicator: ['tuShare/fina_indicator_vip_ss.parquet'],
  mainbz: ['tuShare/fina_mainbz_vip_ss.parquet'],
  forecast: ['tuShare/forecast_ss.parquet'],
  dividend: ['tuShare/dividend_ss.parquet'],
  fflow: ['eastmoney/fflow_stock_ss.parquet'],
  stockList: ['ts_a_stock_list.csv'],
  reportLinks: ['cninfo/report_links_v2.csv'],
  top10Holders: ['tuShare/top10_holders_ss.parquet'],
  top10FloatHolders: ['tuShare/top10_floatholders_ss.parquet'],
  holderNumber: ['tuShare/stk_holdernumber_ss.parquet'],
  repurchase: ['tuShare/repurchase_ss.parquet'],
  holderTrade: ['tuShare/stk_holdertrade_ss.parquet'],
  shareFloat: ['tuShare/share_float_ss.parquet'],
  shock: ['tuShare/stk_shock_ss.parquet'],
  highShock: ['tuShare/stk_high_shock_ss.parquet'],
  alert: ['tuShare/stk_alert_ss.parquet'],
  margin: ['tuShare/margin_ss.parquet'],
  marginDetail: ['tuShare/margin_detail_ss.parquet'],
  marginSecs: ['tuShare/margin_secs_ss.parquet'],
  slbLen: ['tuShare/slb_len_ss.parquet'],
} as const;

export type FileKey = keyof typeof RELATIVE_FILES;

export function requireDataRoot(config: AppConfig): string {
  if (!config.dataRoot) throw new SafeError('data_root_missing', '未设置 TAMA_DATA_ROOT');
  return config.dataRoot;
}

/** 按候选顺序返回第一个存在的文件。都不存在时返回 null，由调用方标 missing。 */
export function existingFile(config: AppConfig, key: FileKey): { relative: string; absolute: string } | null {
  const root = requireDataRoot(config);
  for (const relative of RELATIVE_FILES[key]) {
    const absolute = resolveInsideRoot(root, relative);
    if (fs.existsSync(absolute) && fs.statSync(absolute).isFile()) {
      return { relative, absolute };
    }
  }
  return null;
}
