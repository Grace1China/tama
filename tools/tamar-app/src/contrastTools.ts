import type { AppConfig } from './config.js';
import { argCode, argLimit, argString, argStrings, asRecord } from './args.js';
import { normalizeTsCode } from './codes.js';
import { buildQualityTable } from './finance/qualityTable.js';
import { buildMetricSeries, PAGE_SERIES_METRICS } from './finance/series.js';
import { labelTimes, labelYuan } from './finance/scale.js';
import { freshness } from './freshness.js';
import { kline60Metrics } from './market/price.js';
import { readReportLinks } from './reports.js';
import { SafeError } from './safety.js';
import { loadFinancialData, queryDailyBasic, queryFflow, queryPriceSnapshots, queryQfqKline, readStockList } from './store.js';
import { lookupCompany, type ChainLocation } from './taxonomy/lookup.js';
import { listTaxonomies, loadCompanyCodeMap, normalizeTaxonomyId } from './taxonomy/registry.js';
import { dateDigits, maxDate } from './time.js';

export const contrastTools = [
  tool('contrast_resolve_names', '把公司名或代码解析成 ts_code 列表。', {
    names: { type: 'array', items: { type: 'string' } },
  }, resolveNames, ['names']),
  tool('contrast_stock_basic', '财务对比页的股票基本信息：概况、市值/价格/PE/PB、报告链接、12/8/4/当期表、产业链位置、价倍比和 60 日赔率。taxonomy_id 与 lane 用来指定单链，不会把多条链混成一条。', {
    ts_code: { type: 'string' },
    taxonomy_id: { type: 'string' },
    lane: { type: 'string' },
  }, stockBasic, ['ts_code']),
  tool('contrast_metrics_series', '按 /api/metrics 的口径返回序列。默认 from=2014Q1、to=2026Q4。最新报告期若是 2026Q3，则 2026Q4 为 null。比率带 unit 和 scale。', {
    ts_code: { type: 'string' },
    metrics: { type: 'array', items: { type: 'string' } },
    from: { type: 'string' },
    to: { type: 'string' },
    years: { type: 'number' },
  }, metricsSeries, ['ts_code']),
  tool('contrast_market_series', 'daily_basic 与东财资金流向。两边的 as_of 可能不同，分别标注。', {
    ts_code: { type: 'string' },
    limit: { type: 'number' },
  }, marketSeries, ['ts_code']),
  tool('contrast_kline', '前复权 OHLCV 和换手率。价格由 bfqDir 与 adjFactor 计算，不读取 qfqDir.parquet。', {
    ts_code: { type: 'string' },
    limit: { type: 'number' },
  }, klineTool, ['ts_code']),
  tool('contrast_report_links', '读取已缓存的年报、半年报和投资者关系链接，并标出 cached/stale。', {
    ts_code: { type: 'string' },
  }, reportTool, ['ts_code']),
  tool('contrast_main_business', '读取 fina_mainbz 主营构成。', {
    ts_code: { type: 'string' },
    limit: { type: 'number' },
  }, mainBusiness, ['ts_code']),
  tool('contrast_build_row', '汇总一只股票的对比行：基本信息、指标序列最新点、K 线、主营和报告链接。', {
    ts_code: { type: 'string' },
    taxonomy_id: { type: 'string' },
    lane: { type: 'string' },
  }, buildRow, ['ts_code']),
];

function tool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  handler: (config: AppConfig, args: Record<string, unknown>) => Promise<unknown>,
  required?: string[],
) {
  return {
    name,
    description,
    inputSchema: { type: 'object', properties, additionalProperties: false, ...(required ? { required } : {}) },
    handler,
  };
}

function num(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function resolveNames(config: AppConfig, args: Record<string, unknown>) {
  const names = argStrings(args, 'names');
  if (!names.length) throw new SafeError('bad_names', '需要 names');
  const list = readStockList(config);
  const byName = new Map(list.map((row) => [String(row.name ?? '').trim(), String(row.ts_code ?? '').trim().toUpperCase()]));
  const codeMap = loadCompanyCodeMap(config);
  const resolved = names.map((name) => {
    const code = normalizeTsCode(name);
    if (code) return { input: name, ts_code: code, source: 'ts_code' };
    const fromList = byName.get(name);
    if (fromList && normalizeTsCode(fromList)) return { input: name, ts_code: normalizeTsCode(fromList), source: 'ts_a_stock_list.csv' };
    const fromYaml = codeMap[name];
    if (fromYaml && normalizeTsCode(fromYaml)) return { input: name, ts_code: normalizeTsCode(fromYaml), source: 'industry_company_ts_codes.yaml' };
    return { input: name, ts_code: null, source: null };
  });
  return {
    resolved,
    ts_codes: resolved.map((item) => item.ts_code).filter((code): code is string => !!code),
    ...freshness({
      asOf: null,
      source: 'ts_a_stock_list.csv',
      missing: resolved.every((item) => !item.ts_code),
      compareToSession: false,
    }),
  };
}

function selectLocations(config: AppConfig, tsCode: string, taxonomyId: string, lane: string): ChainLocation[] {
  let locations = lookupCompany(listTaxonomies(config), loadCompanyCodeMap(config), tsCode);
  if (taxonomyId) {
    const id = normalizeTaxonomyId(taxonomyId);
    locations = locations.filter((location) => location.taxonomy_id === id);
  }
  if (lane) {
    locations = locations.map((location) => ({ ...location, sub_lane_title: lane }));
  }
  return locations;
}

async function stockBasic(config: AppConfig, args: Record<string, unknown>) {
  const tsCode = argCode(args);
  const taxonomyId = argString(args, 'taxonomy_id');
  const lane = argString(args, 'lane');
  const profileRow = readStockList(config).find((row) => String(row.ts_code ?? '').toUpperCase() === tsCode) ?? null;
  const locations = selectLocations(config, tsCode, taxonomyId, lane);
  let price: Awaited<ReturnType<typeof queryPriceSnapshots>> | null = null;
  let priceError: string | null = null;
  try {
    price = await queryPriceSnapshots(config, [tsCode]);
  } catch (error) {
    priceError = error instanceof Error ? error.message : 'price_missing';
  }
  let daily: Awaited<ReturnType<typeof queryDailyBasic>> | null = null;
  try {
    daily = await queryDailyBasic(config, tsCode, 1);
  } catch (error) {
    if (!(error instanceof SafeError)) throw error;
  }
  let kline: Awaited<ReturnType<typeof queryQfqKline>> | null = null;
  try {
    kline = await queryQfqKline(config, tsCode, 80);
  } catch (error) {
    if (!(error instanceof SafeError)) throw error;
  }
  const priceRow = price?.rows[0];
  const dailyRow = daily?.rows[0];
  const peTtm = num(dailyRow?.pe_ttm);
  const peStatic = num(dailyRow?.pe);
  const totalMv = num(dailyRow?.total_mv);
  const loaded = await loadFinancialData(config, tsCode).catch(() => null);
  const series = loaded
    ? buildMetricSeries({
        stockCode: tsCode,
        data: loaded.data,
        metricNames: ['roe_dupont', 'grossMargin_ttm', 'netMargin_ttm', 'totalAsset_turnover_ttm', 'rd_exp_ttm', 'sell_exp_ttm', 'admin_exp_ttm', 'total_revenue_ttm'],
        from: '2014Q1',
        to: '2026Q4',
        years: 5,
      })
    : null;
  const pointValues = (series?.points ?? [])
    .filter((point) => !point.missing)
    .map((point) => Object.fromEntries(Object.entries(point.metrics).map(([key, labeled]) => [key, labeled.value])));
  const bars = kline?.bars ?? [];
  return {
    ts_code: tsCode,
    profile: profileRow
      ? {
          name: profileRow.name ?? null,
          area: profileRow.area ?? null,
          industry: profileRow.industry ?? null,
          fullname: profileRow.fullname ?? null,
          list_date: profileRow.list_date ?? null,
          market: profileRow.market ?? null,
        }
      : null,
    cap_price: {
      close: labelYuan(priceRow?.close ?? null, '前复权收盘价'),
      total_mv: labelYuan(totalMv, '总市值', 'wan_yuan'),
      total_mv_yi: totalMv == null ? null : totalMv / 10000,
      pe: peTtm != null ? { ...labelTimes(peTtm, 'PE'), source: 'pe_ttm' } : { ...labelTimes(peStatic, 'PE'), source: 'pe' },
      pb: labelTimes(num(dailyRow?.pb), 'PB'),
    },
    price: price
      ? { ...price, ...freshness({ asOf: priceRow?.trade_date ?? null, source: price.source, missing: !priceRow }) }
      : freshness({ asOf: null, source: 'tuShare/bfqDir.parquet+adjFactor.parquet', missing: true, ...(priceError ? {} : {}) }),
    daily_basic: freshness({
      asOf: dateDigits(dailyRow?.trade_date),
      source: daily?.source ?? 'tuShare/daily_basic.parquet',
      missing: !dailyRow,
    }),
    quality_table: buildQualityTable(pointValues),
    chain_locations: locations,
    chain_note: taxonomyId || lane ? '已按 taxonomy_id/lane 限定位置，没有把其他产业链并进同一条上下文。' : '未传 taxonomy_id 时返回全部命中，每条都带来源链，不合并成混合链。',
    kline_60: kline60Metrics(bars, priceRow?.close ?? bars.at(-1)?.close ?? null),
    report_links: readReportLinks(config, tsCode),
    price_error: priceError,
  };
}

async function metricsSeries(config: AppConfig, args: Record<string, unknown>) {
  const tsCode = argCode(args);
  const requested = argStrings(args, 'metrics');
  const metricNames = requested.length ? requested : PAGE_SERIES_METRICS;
  const loaded = await loadFinancialData(config, tsCode);
  const years = args.years == null ? 5 : Number(args.years);
  const series = buildMetricSeries({
    stockCode: tsCode,
    data: loaded.data,
    metricNames,
    from: argString(args, 'from') || '2014Q1',
    to: argString(args, 'to') || '2026Q4',
    years,
  });
  const hasRows = series.latest_period != null;
  return {
    ...series,
    sources: loaded.sources,
    ...freshness({
      asOf: series.latest_period ? series.latest_period.replace('Q1', '0331').replace('Q2', '0630').replace('Q3', '0930').replace('Q4', '1231') : null,
      source: loaded.sources.income ?? 'tuShare/income_vip_ss.parquet',
      missing: !hasRows,
      compareToSession: false,
    }),
  };
}

async function marketSeries(config: AppConfig, args: Record<string, unknown>) {
  const tsCode = argCode(args);
  const limit = argLimit(args, 60, 500);
  const daily = await queryDailyBasic(config, tsCode, limit).catch((error: unknown) => {
    if (error instanceof SafeError) return null;
    throw error;
  });
  const fflow = await queryFflow(config, tsCode, limit).catch((error: unknown) => {
    if (error instanceof SafeError) return null;
    throw error;
  });
  const dailyAsOf = maxDate((daily?.rows ?? []).map((row) => dateDigits(row.trade_date)));
  const fflowAsOf = maxDate((fflow?.rows ?? []).map((row) => dateDigits(row.trade_date)));
  return {
    ts_code: tsCode,
    daily_basic: {
      rows: (daily?.rows ?? []).map((row) => ({
        ...row,
        pe: { value: num(row.pe), unit: 'times', scale: 'times' },
        pe_ttm: { value: num(row.pe_ttm), unit: 'times', scale: 'times' },
        pb: { value: num(row.pb), unit: 'times', scale: 'times' },
        total_mv: { value: num(row.total_mv), unit: 'CNY', scale: 'wan_yuan' },
        turnover_rate: { value: num(row.turnover_rate), unit: '%', scale: 'percent' },
        close: { value: num(row.close), unit: 'CNY', scale: 'yuan' },
      })),
      ...freshness({ asOf: dailyAsOf, source: daily?.source ?? 'tuShare/daily_basic.parquet', missing: !daily || daily.rows.length === 0 }),
    },
    em_fflow: {
      rows: fflow?.rows ?? [],
      amount_unit: 'CNY',
      amount_scale: 'yuan',
      pct_unit: '%',
      pct_scale: 'percent',
      ...freshness({ asOf: fflowAsOf, source: fflow?.source ?? 'eastmoney/fflow_stock_ss.parquet', missing: !fflow || fflow.rows.length === 0 }),
    },
    note: 'daily_basic 与资金流向的 as_of 可能不是同一天，不能互相代替。',
  };
}

async function klineTool(config: AppConfig, args: Record<string, unknown>) {
  const tsCode = argCode(args);
  const queried = await queryQfqKline(config, tsCode, argLimit(args, 60, 500));
  const asOf = maxDate(queried.bars.map((bar) => bar.trade_date));
  return {
    ts_code: tsCode,
    ...queried,
    ...freshness({ asOf, source: queried.source, missing: queried.bars.length === 0 }),
  };
}

async function reportTool(config: AppConfig, args: Record<string, unknown>) {
  return readReportLinks(config, argCode(args));
}

async function mainBusiness(config: AppConfig, args: Record<string, unknown>) {
  const tsCode = argCode(args);
  const { queryStatement } = await import('./store.js');
  try {
    const rows = await queryStatement(config, 'mainbz', tsCode, argLimit(args, 50, 200));
    const asOf = maxDate(rows.map((row) => dateDigits(row.end_date)));
    return {
      ts_code: tsCode,
      rows,
      amount_unit: 'CNY',
      amount_scale: 'yuan',
      ...freshness({ asOf, source: 'tuShare/fina_mainbz_vip_ss.parquet', missing: rows.length === 0, compareToSession: false }),
    };
  } catch (error) {
    if (error instanceof SafeError && error.code === 'file_missing') {
      return { ts_code: tsCode, rows: [], ...freshness({ asOf: null, source: 'tuShare/fina_mainbz_vip_ss.parquet', missing: true, compareToSession: false }) };
    }
    throw error;
  }
}

async function buildRow(config: AppConfig, args: Record<string, unknown>) {
  const basic = await stockBasic(config, args);
  const series = await metricsSeries(config, { ...asRecord(args), metrics: PAGE_SERIES_METRICS.slice(0, 12) }).catch((error: unknown) => ({
    missing: true,
    error: error instanceof Error ? error.message : 'metrics_failed',
  }));
  const kline = await klineTool(config, { ts_code: argCode(args), limit: 60 }).catch((error: unknown) => ({
    missing: true,
    error: error instanceof Error ? error.message : 'kline_failed',
  }));
  const main = await mainBusiness(config, { ts_code: argCode(args), limit: 20 });
  return { basic, metrics_head: series, kline, main_business: main };
}
