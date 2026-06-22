import fs from 'fs';
import path from 'path';

const TU_SHARE_DIR = path.join(process.cwd(), 'temp/tuShare');

/** 按候选顺序解析 tuShare parquet；首个存在的文件路径 */
export function resolveTuShareParquet(...filenames: string[]): string {
  const tried: string[] = [];
  for (const name of filenames) {
    const p = path.join(TU_SHARE_DIR, name);
    tried.push(p);
    if (fs.existsSync(p)) return p;
  }
  throw new Error(`Parquet file not found: ${tried.join(' | ')}`);
}

/** daily_basic：variant=full 强制全量；否则优先 ss，不存在则回退全量 */
export function resolveDailyBasicParquet(variant: string | null | undefined): string {
  if (variant === 'full') {
    return resolveTuShareParquet('daily_basic.parquet');
  }
  if (variant === 'ss') {
    return resolveTuShareParquet('daily_basic_ss.parquet', 'daily_basic.parquet');
  }
  return resolveTuShareParquet('daily_basic_ss.parquet', 'daily_basic.parquet');
}

/** 资产负债表：优先 ss 分片，回退旧全量文件 */
export function resolveBalanceSheetParquet(): string {
  return resolveTuShareParquet('balancesheet_vip_ss.parquet', 'balanceSheet_vip.parquet');
}

/** 不复权日线 */
export function resolveBfqDirParquet(): string {
  return resolveTuShareParquet('bfqDir.parquet');
}

/** 复权因子 */
export function resolveAdjFactorParquet(): string {
  return resolveTuShareParquet('adjFactor.parquet', 'adjFactor_ss.parquet');
}
