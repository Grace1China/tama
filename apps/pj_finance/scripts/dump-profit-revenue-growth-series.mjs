/**
 * 调用本机 pj_finance 的 /api/metrics，按季列出 profit_growth、revenue_growth，
 * 并附带两行 TTM 便于肉眼核对 CAGR 是否合理。
 *
 * 运行前：`cd apps/pj_finance && npm run dev`（默认端口 3000）
 *
 * 用法：
 *   node scripts/dump-profit-revenue-growth-series.mjs
 *   node scripts/dump-profit-revenue-growth-series.mjs 688041.SH
 *   node scripts/dump-profit-revenue-growth-series.mjs 688041.SH 2021Q1 2026Q4
 *   BASE_URL=http://127.0.0.1:3000 node scripts/dump-profit-revenue-growth-series.mjs
 */

const BASE_URL = process.env.BASE_URL ?? 'http://127.0.0.1:3000';
const tsCode = process.argv[2] ?? '688041.SH';
const from = process.argv[3] ?? '2021Q1';
const to = process.argv[4] ?? '2026Q4';
const YEARS = 5;

/** 格式化数字：null / 非有限显示为横杠 */
function fmtNum(v, digits = 6) {
  if (v == null || v === '') return '—';
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(digits);
}

/** 格式化大数（元）：亿 */
function fmtYi(v, digits = 4) {
  if (v == null || v === '') return '—';
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return '—';
  return `${(n / 1e8).toFixed(digits)}`;
}

async function main() {
  const metrics = [
    'profit_growth',
    'revenue_growth',
    'total_revenue_ttm',
    'n_income_attr_p_ttm',
  ].join(',');

  const url = new URL('/api/metrics', BASE_URL);
  url.searchParams.set('stock', tsCode);
  url.searchParams.set('metrics', metrics);
  url.searchParams.set('from', from);
  url.searchParams.set('to', to);
  url.searchParams.set('years', String(YEARS));

  const res = await fetch(url);
  const json = await res.json().catch(() => null);

  if (!res.ok) {
    console.error('HTTP', res.status, json?.error ?? json?.message ?? String(json));
    process.exitCode = 1;
    return;
  }

  const points = Array.isArray(json?.points) ? json.points : [];
  const sorted = points
    .slice()
    .sort((a, b) => String(a?.period ?? '').localeCompare(String(b?.period ?? '')));

  console.log(`# BASE_URL=${BASE_URL}`);
  console.log(`# ts_code=${tsCode} from=${from} to=${to} years=${YEARS}`);
  console.log('');
  console.log(
    ['period', 'revenue_growth_%', 'profit_growth_%', 'total_revenue_ttm_亿元', 'n_income_attr_p_ttm_亿元'].join(
      '\t',
    ),
  );

  for (const row of sorted) {
    const p = String(row?.period ?? '').trim();
    if (!p) continue;
    console.log(
      [
        p,
        fmtNum(row?.revenue_growth, 4),
        fmtNum(row?.profit_growth, 4),
        fmtYi(row?.total_revenue_ttm),
        fmtYi(row?.n_income_attr_p_ttm),
      ].join('\t'),
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
