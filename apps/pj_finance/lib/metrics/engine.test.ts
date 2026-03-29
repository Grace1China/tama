import test from 'node:test';
import assert from 'node:assert/strict';
import { createMetricEngine, type FinancialData } from '@/lib/metrics/engine';
import { metrics } from '@/lib/metrics/definitions';

/** 累计口径 + 与 route 中 pickNumber(deaccumulate) 一致的单季字段 */
function buildMockData(): FinancialData {
  return {
    income: {
      '2022Q4': {
        total_revenue: 80,
        total_cogs: 48,
        n_income_attr_p: 8,
        total_revenue_q: 80,
        total_cogs_q: 48,
      },
      '2023Q1': {
        total_revenue: 100,
        total_cogs: 60,
        n_income_attr_p: 10,
        total_revenue_q: 100,
        total_cogs_q: 60,
      },
      '2023Q2': {
        total_revenue: 120,
        total_cogs: 72,
        n_income_attr_p: 12,
        total_revenue_q: 20,
        total_cogs_q: 12,
      },
      '2023Q3': {
        total_revenue: 140,
        total_cogs: 84,
        n_income_attr_p: 14,
        total_revenue_q: 20,
        total_cogs_q: 12,
      },
      '2023Q4': {
        total_revenue: 160,
        total_cogs: 96,
        n_income_attr_p: 16,
        total_revenue_q: 20,
        total_cogs_q: 12,
      },
    },
    balance: {
      '2023Q4': { total_hldr_eqy_exc_min_int: 200 },
    },
    cashflow: {},
  };
}

test('grossMargin and roe should be calculated from dependencies', () => {
  const data = buildMockData();
  const engine = createMetricEngine(metrics);

  const grossMargin = engine.calculate('grossMargin', {
    stockCode: '000001.SZ',
    period: '2023Q4',
    data,
  });
  const roe = engine.calculate('roe', {
    stockCode: '000001.SZ',
    period: '2023Q4',
    data,
  });

  assert.equal(grossMargin, 0.4);
  assert.equal(roe, 0.08);
});

test('total_revenue_ttm and total_revenue_yoy should work with period helpers', () => {
  const data = buildMockData();
  const engine = createMetricEngine(metrics);

  const revenueTTM = engine.calculate('total_revenue_ttm', {
    stockCode: '000001.SZ',
    period: '2023Q4',
    data,
  });
  const revenueYoY = engine.calculate('total_revenue_yoy', {
    stockCode: '000001.SZ',
    period: '2023Q4',
    data,
  });

  assert.equal(revenueTTM, 160);
  assert.equal(revenueYoY, 1);
});
