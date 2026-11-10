import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { normalizeTsCode } from '../src/codes.js';
import { loadConfig } from '../src/config.js';
import { execSql } from '../src/duck.js';
import { labelMetric } from '../src/finance/scale.js';
import { buildMetricSeries } from '../src/finance/series.js';
import { presentStatement } from '../src/finance/statements.js';
import { readAuctionSnapshots } from '../src/auction.js';
import { joinQfq, type AdjFactor, type BfqBar } from '../src/market/qfq.js';
import { priceSnapshotsFromBars } from '../src/market/price.js';
import { priceSnapshotSql } from '../src/market/sql.js';
import { RELATIVE_FILES } from '../src/paths.js';
import { queryPriceSnapshots } from '../src/store.js';
import { lookupCompany } from '../src/taxonomy/lookup.js';
import { listTaxonomies, loadCompanyCodeMap } from '../src/taxonomy/registry.js';
import { expectedLastSession } from '../src/time.js';
import type { FinancialData } from '../src/metrics/engine.js';

const FIXTURE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

function fixtureConfig(extra: NodeJS.ProcessEnv = {}) {
  return loadConfig({
    TAMA_DATA_ROOT: extra.TAMA_DATA_ROOT,
    TAMAR_APP_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'tamar-home-')),
    TAMAR_TAXONOMY_DIR: path.join(FIXTURE_ROOT, 'taxonomies'),
    TAMAR_APP_PORT: '3012',
    ...extra,
  });
}

test('ts_code 接受带后缀和 6 位代码', () => {
  assert.equal(normalizeTsCode('688072.SH'), '688072.SH');
  assert.equal(normalizeTsCode('688072.sh'), '688072.SH');
  assert.equal(normalizeTsCode('688072'), '688072.SH');
  assert.equal(normalizeTsCode('000001'), '000001.SZ');
  assert.equal(normalizeTsCode('300308'), '300308.SZ');
  assert.equal(normalizeTsCode('830001'), '830001.BJ');
  assert.equal(normalizeTsCode('拓荆科技'), null);
});

test('688072 与 688120 同时命中 tao 和 hbm', () => {
  const config = fixtureConfig();
  const records = listTaxonomies(config);
  const codes = loadCompanyCodeMap(config);
  for (const query of ['688072.SH', '688072', '688120', '拓荆科技', '华海清科']) {
    const hits = lookupCompany(records, codes, query);
    const ids = hits.map((hit) => hit.taxonomy_id).sort();
    assert.deepEqual(ids, ['hbm', 'tao'], query);
    assert.ok(hits.every((hit) => hit.taxonomy_label && hit.source_file));
    assert.ok(hits.every((hit) => hit.certainty));
  }
  const tao = lookupCompany(records, codes, '688072').find((hit) => hit.taxonomy_id === 'tao');
  assert.equal(tao?.sub_lane_title, '半导体设备');
  assert.equal(tao?.certainty, '高');
  const hbm = lookupCompany(records, codes, '688120').find((hit) => hit.taxonomy_id === 'hbm');
  assert.equal(hbm?.sub_lane_title, '减薄沉积与混合键合设备');
  assert.equal(hbm?.certainty, '中高');
});

test('前复权用 bfq 与 adj 的 ASOF，涨跌幅沿用页面口径', () => {
  const bars: BfqBar[] = [
    bar('20261027', 10, 0),
    bar('20261028', 10, 0),
    bar('20261029', 10, 0),
    bar('20261030', 10, 0),
    bar('20261031', 10, 0),
    bar('20261103', 12, 9.9, 10),
  ];
  const factors: AdjFactor[] = [
    { ts_code: '688072.SH', trade_date: '20261001', adj_factor: 1 },
    { ts_code: '688072.SH', trade_date: '20261101', adj_factor: 2 },
    { ts_code: '688072.SH', trade_date: '20261110', adj_factor: 4 },
  ];
  const joined = joinQfq(bars, factors);
  const latest = joined.find((item) => item.trade_date === '20261103');
  assert.ok(latest);
  assert.equal(latest?.adj_factor, 2);
  assert.equal(latest?.latest_adj, 4);
  assert.equal(latest?.close, 6);
  const snapshots = priceSnapshotsFromBars(joined.map((item) => ({
    ts_code: item.ts_code,
    trade_date: item.trade_date,
    close: item.close,
    pre_close: item.pre_close,
    pct_chg: item.pct_chg,
  })));
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].d1, 9.9);
  assert.equal(snapshots[0].d1_source, 'pct_chg');
  // 更早的 K 线 ASOF 到因子 1，最新一根用因子 2，最新因子是 4。
  // 前复权收盘 2.5 -> 6，d5 = (6 / 2.5 - 1) * 100。
  assert.equal(snapshots[0].d5, 140);
  assert.equal(snapshots[0].d20, null);
  assert.equal(snapshots[0].d60, null);
  assert.equal(snapshots[0].scale, 'percent');
  const sql = priceSnapshotSql('/tmp/bfqDir.parquet', '/tmp/adjFactor.parquet', ['688072.SH']);
  assert.equal(sql.includes('qfqDir'), false);
  assert.equal(sql.includes('bfqDir.parquet'), true);
  assert.equal(sql.includes('adjFactor.parquet'), true);
  const files = Object.values(RELATIVE_FILES).flat();
  assert.equal(files.some((file) => file.includes('qfqDir')), false);
});

test('小 parquet 上的前复权涨跌幅与内存口径一致', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tamar-px-'));
  const tu = path.join(root, 'tuShare');
  fs.mkdirSync(tu);
  const bfq = path.join(tu, 'bfqDir.parquet').replace(/\\/g, '/');
  const adj = path.join(tu, 'adjFactor.parquet').replace(/\\/g, '/');
  await execSql(`
    COPY (
      SELECT * FROM (VALUES
        ('688072.SH', DATE '2026-10-27', 10::DOUBLE, 10::DOUBLE, 9::DOUBLE, 10::DOUBLE, 10::DOUBLE, 0::DOUBLE, 0::DOUBLE, 100::DOUBLE, 1000::DOUBLE),
        ('688072.SH', DATE '2026-10-28', 10::DOUBLE, 10::DOUBLE, 9::DOUBLE, 10::DOUBLE, 10::DOUBLE, 0::DOUBLE, 0::DOUBLE, 100::DOUBLE, 1000::DOUBLE),
        ('688072.SH', DATE '2026-10-29', 10::DOUBLE, 10::DOUBLE, 9::DOUBLE, 10::DOUBLE, 10::DOUBLE, 0::DOUBLE, 0::DOUBLE, 100::DOUBLE, 1000::DOUBLE),
        ('688072.SH', DATE '2026-10-30', 10::DOUBLE, 10::DOUBLE, 9::DOUBLE, 10::DOUBLE, 10::DOUBLE, 0::DOUBLE, 0::DOUBLE, 100::DOUBLE, 1000::DOUBLE),
        ('688072.SH', DATE '2026-10-31', 10::DOUBLE, 10::DOUBLE, 9::DOUBLE, 10::DOUBLE, 10::DOUBLE, 0::DOUBLE, 0::DOUBLE, 100::DOUBLE, 1000::DOUBLE),
        ('688072.SH', DATE '2026-11-03', 12::DOUBLE, 13::DOUBLE, 11::DOUBLE, 12::DOUBLE, 10::DOUBLE, 2::DOUBLE, 9.9::DOUBLE, 100::DOUBLE, 1000::DOUBLE)
      ) AS t(ts_code, trade_date, open, high, low, "close", pre_close, change, pct_chg, vol, amount)
    ) TO '${bfq}' (FORMAT PARQUET)
  `);
  await execSql(`
    COPY (
      SELECT * FROM (VALUES
        ('688072.SH', DATE '2026-10-01', 1::DOUBLE),
        ('688072.SH', DATE '2026-11-01', 2::DOUBLE),
        ('688072.SH', DATE '2026-11-10', 4::DOUBLE)
      ) AS t(ts_code, trade_date, adj_factor)
    ) TO '${adj}' (FORMAT PARQUET)
  `);
  const config = fixtureConfig({ TAMA_DATA_ROOT: root });
  const queried = await queryPriceSnapshots(config, ['688072.SH']);
  assert.equal(queried.rows.length, 1);
  assert.equal(queried.rows[0].close, 6);
  assert.equal(queried.rows[0].d1, 9.9);
  assert.equal(queried.rows[0].d5, 140);
  assert.equal(queried.rows[0].scale, 'percent');
  assert.equal(queried.source.includes('qfqDir'), false);
});

test('现金流量表 Q1 的 net_profit 保持 null，费用列仍是 finan_exp', () => {
  const presented = presentStatement('cashflow', [{
    ts_code: '688072.SH',
    end_date: '20260331',
    report_type: '1',
    net_profit: null,
    finan_exp: 12.5,
    fin_exp: 99,
    n_cashflow_act: 100,
  }]);
  assert.equal(presented.expense_field, 'finan_exp');
  assert.equal(presented.rows[0].net_profit, null);
  assert.equal(Object.prototype.hasOwnProperty.call(presented.rows[0], 'net_profit'), true);
  assert.equal(presented.rows[0].finan_exp, 12.5);
  assert.equal(JSON.parse(JSON.stringify(presented.rows[0])).net_profit, null);
  const income = presentStatement('income', [{ fin_exp: 3, net_profit: 8 }]);
  assert.equal(income.expense_field, 'fin_exp');
  assert.equal(income.rows[0].fin_exp, 3);
});

test('集合竞价文件缺失时 missing 为 true', () => {
  const config = fixtureConfig();
  const result = readAuctionSnapshots(config, ['688072.SH']);
  assert.equal(result.missing, true);
  assert.deepEqual(result.rows, []);
  assert.match(result.note ?? '', /不存在/);
});

test('比率标明 ratio_0_1 或 percent，2026Q4 在最新为 2026Q3 时为 null', () => {
  const gross = labelMetric('grossMargin_ttm', 0.25);
  assert.equal(gross.scale, 'ratio_0_1');
  assert.equal(gross.unit, '%');
  assert.equal(gross.percent_value, 25);
  const growth = labelMetric('profit_growth', 12);
  assert.equal(growth.scale, 'percent');
  assert.equal(growth.percent_value, null);
  const turnover = labelMetric('totalAsset_turnover_ttm', 0.8);
  assert.equal(turnover.scale, 'times');
  const mv = labelMetric('total_mv', 100000);
  assert.equal(mv.scale, 'wan_yuan');

  const data: FinancialData = {
    income: { '2026Q3': { total_revenue: 100, total_revenue_q: 100 } },
    balance: {},
    cashflow: {},
    dividend: {},
    market: {},
  };
  const series = buildMetricSeries({
    stockCode: '688072.SH',
    data,
    metricNames: ['total_revenue'],
    from: '2014Q1',
    to: '2026Q4',
  });
  const last = series.points.at(-1);
  assert.equal(last?.period, '2026Q4');
  assert.equal(last?.missing, true);
  assert.equal(last?.metrics.total_revenue.value, null);
  assert.equal(series.latest_period, '2026Q3');
});

test('预期最近交易日按上海时间收盘计算', () => {
  const afterClose = Date.parse('2026-11-10T11:21:00Z');
  assert.equal(expectedLastSession(afterClose), '20261110');
  const beforeClose = Date.parse('2026-11-09T02:00:00Z');
  assert.equal(expectedLastSession(beforeClose), '20261106');
});

test('拒绝 3000、3001、3011 和其他监听地址', () => {
  assert.throws(() => fixtureConfig({ TAMAR_APP_PORT: '3011' }), /3011/);
  assert.throws(() => fixtureConfig({ TAMAR_APP_PORT: '3001' }), /3001/);
  assert.throws(() => loadConfig({ TAMAR_APP_HOST: '0.0.0.0', TAMAR_APP_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'tamar-home-')) }), /127\.0\.0\.1/);
});

function bar(tradeDate: string, close: number, pct: number, pre = close): BfqBar {
  return {
    ts_code: '688072.SH',
    trade_date: tradeDate,
    open: close,
    high: close,
    low: close,
    close,
    pre_close: pre,
    change: close - pre,
    pct_chg: pct,
    vol: 1,
    amount: 1,
  };
}
