import type { AppConfig } from './config.js';
import { argCodes, argString } from './args.js';
import { readAuctionSnapshots } from './auction.js';
import { normalizeTsCode } from './codes.js';
import { freshness } from './freshness.js';
import { SafeError } from './safety.js';
import { queryFinancialGrowth, queryFinancialQuality, queryPriceSnapshots, queryWeekPct } from './store.js';
import { lookupCompany, sublaneCompanies, universeOf, laneTree } from './taxonomy/lookup.js';
import { companyCount, listTaxonomies, loadCompanyCodeMap, normalizeTaxonomyId } from './taxonomy/registry.js';
import { maxDate } from './time.js';

export const industryTools = [
  tool('industry_list_taxonomies', '列出已启用产业链：id、名称、顺序、公司数。', {}, listTaxonomiesTool),
  tool('industry_get_taxonomy', '读取一条产业链的泳道树。确定性读 YAML 键「确定性」，不是「重要性」。', {
    taxonomy_id: { type: 'string' },
  }, getTaxonomy, ['taxonomy_id']),
  tool('industry_company_lookup', '按公司名或 ts_code 返回全部产业链命中。同一公司在 tao 和 hbm 会同时返回，并标明来源 taxonomy。', {
    query: { type: 'string', description: '公司名、688072 或 688072.SH' },
  }, lookupTool, ['query']),
  tool('industry_sublane_companies', '列出某个子泳道里的公司。', {
    taxonomy_id: { type: 'string' },
    sub_lane: { type: 'string' },
  }, sublaneTool, ['taxonomy_id', 'sub_lane']),
  tool('industry_price_snapshots', '前复权收盘与 d1/d5/d20/d60。d1 优先 bfq.pct_chg，5/20/60 为交易日偏移。不读取 qfqDir.parquet。', {
    ts_code: { type: 'string' },
    ts_codes: { type: 'array', items: { type: 'string' } },
  }, priceTool),
  tool('industry_financial_quality', '最新报告期 ROE、权益乘数、毛利率。ROE/毛利率为百分数，权益乘数为倍数。', {
    ts_code: { type: 'string' },
    ts_codes: { type: 'array', items: { type: 'string' } },
  }, qualityTool),
  tool('industry_financial_growth', '只用年报计算营收和归母净利润 CAGR，单位为百分数。', {
    ts_code: { type: 'string' },
    ts_codes: { type: 'array', items: { type: 'string' } },
  }, growthTool),
  tool('industry_market_breadth', '产业链涨跌家数。mode=day 用 d1，mode=week 用最近 5 个交易日的 bfq.pct_chg。', {
    mode: { type: 'string', description: 'day 或 week，默认 day' },
    taxonomy_id: { type: 'string' },
  }, breadthTool),
  tool('industry_auction_snapshots', '读取集合竞价 latest.json。文件不存在时 missing=true。', {
    ts_code: { type: 'string' },
    ts_codes: { type: 'array', items: { type: 'string' } },
  }, auctionTool),
  tool('industry_card', '汇总一家公司的产业链位置、行情、财务质量和成长。传入 taxonomy_id 时只保留该链，避免把多条链混成一条。', {
    query: { type: 'string' },
    ts_code: { type: 'string' },
    taxonomy_id: { type: 'string' },
  }, cardTool),
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

function records(config: AppConfig) {
  return listTaxonomies(config);
}

async function listTaxonomiesTool(config: AppConfig) {
  const items = records(config);
  return {
    taxonomies: items.map((item) => ({
      id: item.id,
      label: item.label,
      order: item.order,
      filename: item.filename,
      company_count: companyCount(item.taxonomy),
    })),
    ...freshness({
      asOf: null,
      source: config.taxonomyDir ?? 'taxonomies',
      missing: items.length === 0,
      compareToSession: false,
    }),
  };
}

async function getTaxonomy(config: AppConfig, args: Record<string, unknown>) {
  const id = normalizeTaxonomyId(argString(args, 'taxonomy_id'));
  const item = records(config).find((record) => record.id === id);
  if (!item) {
    return { taxonomy_id: id, ...freshness({ asOf: null, source: 'taxonomy', missing: true, compareToSession: false }) };
  }
  return laneTree(item, loadCompanyCodeMap(config));
}

async function lookupTool(config: AppConfig, args: Record<string, unknown>) {
  const query = argString(args, 'query');
  const hits = lookupCompany(records(config), loadCompanyCodeMap(config), query);
  return {
    query,
    count: hits.length,
    locations: hits,
    ...freshness({
      asOf: null,
      source: config.taxonomyDir ?? 'taxonomies',
      missing: hits.length === 0,
      compareToSession: false,
    }),
  };
}

async function sublaneTool(config: AppConfig, args: Record<string, unknown>) {
  const id = normalizeTaxonomyId(argString(args, 'taxonomy_id'));
  const item = records(config).find((record) => record.id === id);
  if (!item) throw new SafeError('taxonomy_missing', `没有产业链 ${id}`);
  const companies = sublaneCompanies(item, loadCompanyCodeMap(config), argString(args, 'sub_lane'));
  return {
    taxonomy_id: id,
    taxonomy_label: item.label,
    sub_lane: argString(args, 'sub_lane'),
    companies,
    ...freshness({ asOf: null, source: item.filename, missing: companies.length === 0, compareToSession: false }),
  };
}

async function priceTool(config: AppConfig, args: Record<string, unknown>) {
  const codes = argCodes(args);
  try {
    const queried = await queryPriceSnapshots(config, codes);
    const asOf = maxDate(queried.rows.map((row) => row.trade_date));
    return {
      rows: queried.rows,
      price_basis: 'qfq_from_bfq_adj',
      ...freshness({ asOf, source: queried.source, missing: queried.rows.length === 0 }),
    };
  } catch (error) {
    if (error instanceof SafeError && error.code === 'file_missing') {
      return { rows: [], price_basis: 'qfq_from_bfq_adj', ...freshness({ asOf: null, source: 'tuShare/bfqDir.parquet+adjFactor.parquet', missing: true }) };
    }
    throw error;
  }
}

async function qualityTool(config: AppConfig, args: Record<string, unknown>) {
  const codes = argCodes(args);
  try {
    const queried = await queryFinancialQuality(config, codes);
    const asOf = maxDate(queried.rows.map((row) => row.report_date));
    return {
      rows: queried.rows,
      ...freshness({ asOf, source: queried.source, missing: queried.rows.length === 0, compareToSession: false }),
    };
  } catch (error) {
    if (error instanceof SafeError && error.code === 'file_missing') {
      return { rows: [], ...freshness({ asOf: null, source: 'tuShare/fina_indicator_vip_ss.parquet', missing: true, compareToSession: false }) };
    }
    throw error;
  }
}

async function growthTool(config: AppConfig, args: Record<string, unknown>) {
  const codes = argCodes(args);
  try {
    const queried = await queryFinancialGrowth(config, codes);
    const asOf = maxDate(queried.rows.map((row) => row.report_date));
    return {
      annual_only: true,
      rows: queried.rows,
      ...freshness({ asOf, source: queried.source, missing: queried.rows.length === 0, compareToSession: false }),
    };
  } catch (error) {
    if (error instanceof SafeError && error.code === 'file_missing') {
      return { rows: [], annual_only: true, ...freshness({ asOf: null, source: 'tuShare/income_vip_ss.parquet', missing: true, compareToSession: false }) };
    }
    throw error;
  }
}

async function breadthTool(config: AppConfig, args: Record<string, unknown>) {
  const mode = argString(args, 'mode') || 'day';
  if (mode !== 'day' && mode !== 'week') throw new SafeError('bad_mode', 'mode 只能是 day 或 week');
  const id = argString(args, 'taxonomy_id');
  const all = records(config).filter((item) => !id || item.id === normalizeTaxonomyId(id));
  const nameToCode = loadCompanyCodeMap(config);
  const universes = all.map((item) => ({ item, ...universeOf(item.taxonomy, nameToCode) }));
  const codes = [...new Set(universes.flatMap((item) => item.codes))];
  if (mode === 'week') {
    if (!codes.length) {
      return { mode, rows: [], ...freshness({ asOf: null, source: 'tuShare/bfqDir.parquet', missing: true }) };
    }
    let queried: Awaited<ReturnType<typeof queryWeekPct>>;
    try {
      queried = await queryWeekPct(config, codes);
    } catch (error) {
      if (error instanceof SafeError && error.code === 'file_missing') {
        return { mode, rows: [], ...freshness({ asOf: null, source: 'tuShare/bfqDir.parquet', missing: true }) };
      }
      throw error;
    }
    const byDate = new Map<string, Map<string, number | null>>();
    for (const row of queried.rows) {
      const date = String(row.trade_date ?? '');
      const code = String(row.ts_code ?? '').toUpperCase();
      const pct = row.pct_chg == null ? null : Number(row.pct_chg);
      const bucket = byDate.get(date) ?? new Map<string, number | null>();
      bucket.set(code, Number.isFinite(pct as number) ? (pct as number) : null);
      byDate.set(date, bucket);
    }
    const dates = [...byDate.keys()].sort();
    const rows = universes.map((universe) => ({
      id: universe.item.id,
      label: universe.item.label,
      total: universe.codes.length + universe.unmapped,
      by_date: Object.fromEntries(dates.map((date) => {
        const bucket = byDate.get(date);
        let up = 0;
        let down = 0;
        let flat = 0;
        let missing = universe.unmapped;
        for (const code of universe.codes) {
          if (!bucket?.has(code) || bucket.get(code) == null) missing += 1;
          else if ((bucket.get(code) as number) > 0) up += 1;
          else if ((bucket.get(code) as number) < 0) down += 1;
          else flat += 1;
        }
        return [date, { up, down, flat, missing, ratio: `${up}:${down}`, unit: '%', scale: 'percent' }];
      })),
    }));
    return {
      mode,
      dates,
      rows,
      ...freshness({ asOf: dates.at(-1) ?? null, source: queried.source, missing: dates.length === 0 }),
    };
  }
  let snapshots: Array<{ ts_code: string; trade_date: string; d1: number | null }> = [];
  let source = 'tuShare/bfqDir.parquet+adjFactor.parquet';
  if (codes.length) {
    try {
      const queried = await queryPriceSnapshots(config, codes);
      source = queried.source;
      snapshots = queried.rows;
    } catch (error) {
      if (!(error instanceof SafeError && error.code === 'file_missing')) throw error;
    }
  }
  const byCode = new Map(snapshots.map((row) => [row.ts_code, row]));
  const tradeDate = maxDate(snapshots.map((row) => row.trade_date)) ?? '';
  const rows: Record<string, { up: number; down: number; flat: number; missing: number; total: number }> = {};
  for (const universe of universes) {
    let up = 0;
    let down = 0;
    let flat = 0;
    let missing = universe.unmapped;
    for (const code of universe.codes) {
      const snapshot = byCode.get(code);
      if (!snapshot || !tradeDate || snapshot.trade_date !== tradeDate || snapshot.d1 == null) missing += 1;
      else if (snapshot.d1 > 0) up += 1;
      else if (snapshot.d1 < 0) down += 1;
      else flat += 1;
    }
    rows[universe.item.id] = { up, down, flat, missing, total: universe.codes.length + universe.unmapped };
  }
  return {
    mode,
    trade_date: tradeDate || null,
    rows,
    ...freshness({ asOf: tradeDate || null, source, missing: !tradeDate }),
  };
}

async function auctionTool(config: AppConfig, args: Record<string, unknown>) {
  return readAuctionSnapshots(config, argCodes(args));
}

async function cardTool(config: AppConfig, args: Record<string, unknown>) {
  const query = argString(args, 'query') || argString(args, 'ts_code');
  if (!query) throw new SafeError('bad_query', '需要 query 或 ts_code');
  const taxonomyId = argString(args, 'taxonomy_id');
  let locations = lookupCompany(records(config), loadCompanyCodeMap(config), query);
  if (taxonomyId) locations = locations.filter((location) => location.taxonomy_id === normalizeTaxonomyId(taxonomyId));
  const code = normalizeTsCode(query) ?? locations.find((location) => location.ts_code)?.ts_code ?? null;
  const price = code ? await priceTool(config, { ts_code: code }) : null;
  const quality = code ? await qualityTool(config, { ts_code: code }) : null;
  const growth = code ? await growthTool(config, { ts_code: code }) : null;
  const auction = code ? await auctionTool(config, { ts_code: code }) : null;
  return {
    query,
    ts_code: code,
    taxonomy_id: taxonomyId || null,
    locations,
    price,
    financial_quality: quality,
    financial_growth: growth,
    auction,
  };
}
