'use client';

import { useState, useEffect } from 'react';
import DataGrid from '../components/DataGrid';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

interface StockInfo {
  name: string;
  area: string;
  industry: string;
}

export default function CashflowStatementPage() {
  const [selectedTsCode, setSelectedTsCode] = useState<string>('');
  const [stockInfo, setStockInfo] = useState<StockInfo | null>(null);

  const CASHFLOW_VALUE_MAPPINGS: Record<string, Record<string, string>> = {
    comp_type: {
      '1': '1-一般工商业',
      '2': '2-银行',
      '3': '3-保险',
      '4': '4-证券',
    },
    end_type: {
      '1': '1-一季报',
      '2': '2-半年报',
      '3': '3-三季报',
      '4': '4-年报',
    },
    report_type: {
      '1': '1-合并报表',
      '2': '2-单季合并',
      '3': '3-调整单季合并表',
      '4': '4-调整合并报表',
      '5': '5-调整前合并报表',
      '6': '6-母公司报表',
      '7': '7-母公司单季表',
      '8': '8-母公司调整单季表',
      '9': '9-母公司调整表',
      '10': '10-母公司调整前报表',
      '11': '11-母公司调整前合并报表',
      '12': '12-母公司调整前报表',
    },
  };

  const CASHFLOW_YI_FIELDS = new Set([
    'net_profit', 'c_fr_sale_sg', 'c_inf_fr_operate_a', 'c_paid_goods_s',
    'c_paid_to_for_empl', 'c_paid_for_taxes', 'st_cash_out_act', 'n_cashflow_act',
    'stot_inflows_inv_act', 'c_pay_acq_const_fiolta', 'c_paid_invest',
    'stot_out_inv_act', 'n_cashflow_inv_act', 'c_recp_borrow', 'stot_cash_in_fnc_act',
    'free_cashflow', 'c_prepay_amt_borr', 'c_pay_dist_dpcp_int_exp',
    'stot_cashout_fnc_act', 'n_cash_flows_fnc_act', 'n_incr_cash_cash_equ',
    'c_cash_equ_beg_period', 'c_cash_equ_end_period',
  ]);

  useEffect(() => {
    if (!selectedTsCode.trim()) {
      setStockInfo(null);
      return;
    }
    let cancelled = false;
    const fetchStockInfo = async () => {
      try {
        const res = await fetch(
          `/api/csv/stockList?ts_code=${encodeURIComponent(selectedTsCode.trim())}`,
        );
        if (!res.ok || cancelled) return;
        const json = await res.json();
        if (cancelled) return;
        const row = json.data?.[0];
        if (row) {
          setStockInfo({
            name: String(row.name ?? '').trim() || '—',
            area: String(row.area ?? '').trim() || '—',
            industry: String(row.industry ?? '').trim() || '—',
          });
        } else {
          setStockInfo(null);
        }
      } catch {
        if (!cancelled) setStockInfo(null);
      }
    };
    fetchStockInfo();
    return () => {
      cancelled = true;
    };
  }, [selectedTsCode]);

  return (
    <div className="space-y-6">
      {/* 控制面板 */}
      <div className="flex flex-wrap items-center gap-4 p-4 bg-white rounded-lg border border-gray-200">
        <div className="flex items-center gap-2">
          <label htmlFor="tsCode" className="text-sm font-medium text-gray-700">
            股票代码:
          </label>
          <Input
            id="tsCode"
            type="text"
            placeholder="例如: 000001.SZ"
            value={selectedTsCode}
            onChange={(e) => setSelectedTsCode(e.target.value)}
            className="w-40"
          />
        </div>

        {stockInfo && (
          <div className="flex flex-wrap items-center gap-3 ml-2 pl-4 border-l border-gray-200">
            <span className="inline-flex items-center gap-1.5 text-sm text-gray-700">
              <span className="font-medium text-gray-500">名称</span>
              <span className="font-medium text-gray-900">{stockInfo.name}</span>
            </span>
            <span className="inline-flex items-center gap-1.5 text-sm text-gray-700">
              <span className="font-medium text-gray-500">所在地</span>
              <span className="text-gray-800">{stockInfo.area}</span>
            </span>
            <span className="inline-flex items-center gap-1.5 text-sm text-gray-700">
              <span className="font-medium text-gray-500">行业</span>
              <span className="rounded bg-gray-100 px-2 py-0.5 text-gray-800">{stockInfo.industry}</span>
            </span>
          </div>
        )}
      </div>

      {/* 数据表格 */}
      <Tabs defaultValue="merged" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="merged">合并报表</TabsTrigger>
          <TabsTrigger value="quarterly">单季报表</TabsTrigger>
        </TabsList>
        <TabsContent value="merged">
          <DataGrid
            category="cashflowStatement"
            title="现金流量表 - 合并报表"
            useServerPagination={true}
            apiPath="/api/parq/cashflowStatement"
            extraQueryParams={selectedTsCode ? { ts_code: selectedTsCode, file: 'merged' } : { file: 'merged' }}
            valueMappings={CASHFLOW_VALUE_MAPPINGS}
            yiFields={CASHFLOW_YI_FIELDS}
          />
        </TabsContent>
        <TabsContent value="quarterly">
          <DataGrid
            category="cashflowStatementQ"
            title="现金流量表 - 单季报表"
            useServerPagination={true}
            apiPath="/api/parq/cashflowStatement"
            extraQueryParams={selectedTsCode ? { ts_code: selectedTsCode, file: 'quarterly' } : { file: 'quarterly' }}
            valueMappings={CASHFLOW_VALUE_MAPPINGS}
            yiFields={CASHFLOW_YI_FIELDS}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
