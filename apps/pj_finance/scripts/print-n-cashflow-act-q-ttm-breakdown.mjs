/**
 * 从 parquet 复现 route.ts 现金流量累计→单季逻辑，打印某 period 的 n_cashflow_act_tTM 所含四季 n_cashflow_act_q。
 * 运行: node scripts/print-n-cashflow-act-q-ttm-breakdown.mjs 002215.SZ 2026Q1
 */
const duckdb = require('duckdb');
const path = require('path');
const fs = require('fs');

const stock = process.argv[2] || '002215.SZ';
const anchorPeriod = process.argv[3] || '2026Q1';

function normalizeEndDateToPeriod(endDate) {
  const text = String(endDate).replace(/\D/g, '');
  if (!/^\d{8}$/.test(text)) return null;
  const year = text.slice(0, 4);
  const mmdd = text.slice(4);
  const map = { '0331': 'Q1', '0630': 'Q2', '0930': 'Q3', '1231': 'Q4' };
  const q = map[mmdd];
  return q ? `${year}${q}` : null;
}

function parsePeriod(period) {
  const m = String(period).match(/^(\d{4})Q([1-4])$/);
  if (!m) throw new Error(`Invalid period: ${period}`);
  return { year: Number(m[1]), quarter: Number(m[2]) };
}

function formatPeriod(year, quarter) {
  return `${year}Q${quarter}`;
}

/** 与 lib/metrics/period.ts lastNQuarters 一致 */
function lastNQuarters(period, n) {
  const periods = [];
  let cursor = parsePeriod(period);
  for (let i = 0; i < n; i += 1) {
    periods.push(formatPeriod(cursor.year, cursor.quarter));
    if (cursor.quarter === 1) {
      cursor = { year: cursor.year - 1, quarter: 4 };
    } else {
      cursor = { year: cursor.year, quarter: cursor.quarter - 1 };
    }
  }
  return periods;
}

function previousQuarterSameYear(period) {
  const { year, quarter } = parsePeriod(period);
  if (quarter <= 1) return null;
  return `${year}Q${quarter - 1}`;
}

function endDateSortKey(endDate) {
  const text = String(endDate ?? '').replace(/\D/g, '');
  if (/^\d{8}$/.test(text)) return Number(text);
  return 0;
}

function readQuarterField(quarterData, period, keys) {
  const slice = quarterData[period];
  if (!slice) return null;
  for (const key of keys) {
    const v = slice[key];
    if (v == null) continue;
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  return null;
}

function pickNumber(row, keys, opts, ctx) {
  let current = null;
  for (const key of keys) {
    const v = row[key];
    if (v == null) continue;
    const n = Number(v);
    if (!Number.isNaN(n)) {
      current = n;
      break;
    }
  }
  if (current == null) return null;
  if (!opts?.deaccumulateQuarterly || !ctx) return current;

  const { quarter } = parsePeriod(ctx.period);
  const prevP = previousQuarterSameYear(ctx.period);
  const source = ctx.cashflow;
  const prevYtd = source && prevP ? readQuarterField(source, prevP, keys) : null;
  if (quarter === 1) return current;
  if (prevYtd == null) return null;
  return current - prevYtd;
}

const parq = path.join(process.cwd(), 'temp/tuShare/cashflow_vip_ss.parquet');
if (!fs.existsSync(parq)) {
  console.error('找不到', parq);
  process.exit(1);
}

const db = new duckdb.Database(':memory:');
const sql = `SELECT end_date, n_cashflow_act FROM read_parquet('${parq.replace(/'/g, "''")}') WHERE ts_code='${stock.replace(/'/g, "''")}' ORDER BY end_date ASC`;

db.all(sql, (err, rows) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  const cashflow = {};

  for (const row of rows) {
    const period = normalizeEndDateToPeriod(row.end_date);
    if (!period) continue;
    const ytd = pickNumber(row, ['n_cashflow_act'], null, null);
    const nq = pickNumber(row, ['n_cashflow_act'], { deaccumulateQuarterly: true }, { cashflow, period });
    cashflow[period] = {
      n_cashflow_act: ytd,
      n_cashflow_act_q: nq,
      end_date: String(row.end_date).replace(/\D/g, ''),
    };
  }

  const four = lastNQuarters(anchorPeriod, 4);
  console.log(`股票: ${stock}   TTM 锚点 period: ${anchorPeriod}`);
  console.log('TTM 使用的四个季度（与 definitions.n_cashflow_act_ttm / lastNQuarters 一致）:');
  console.log('');

  let sum = 0;
  let allOk = true;
  for (const p of four) {
    const cell = cashflow[p];
    const ed = cell?.end_date ?? '(无该行)';
    const ytd = cell?.n_cashflow_act;
    const q = cell?.n_cashflow_act_q;
    const qYi = q != null && Number.isFinite(q) ? (q / 1e8).toFixed(4) : 'null';
    const ytdYi = ytd != null && Number.isFinite(ytd) ? (ytd / 1e8).toFixed(4) : 'null';
    console.log(`period=${p}   end_date=${ed}`);
    console.log(`  n_cashflow_act(累计,元)= ${ytd ?? 'null'}   ≈${ytdYi}亿`);
    console.log(`  n_cashflow_act_q(单季,元)= ${q ?? 'null'}   ≈${qYi}亿`);
    console.log('');
    if (q == null || !Number.isFinite(q)) allOk = false;
    else sum += q;
  }

  console.log(`---`);
  console.log(`n_cashflow_act_ttm (四季单季之和, 元)= ${allOk ? sum : 'N/A'}`);
  if (allOk) console.log(`≈ ${(sum / 1e8).toFixed(4)} 亿`);
  db.close();
});
