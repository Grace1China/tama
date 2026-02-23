'use client';

import { useState } from 'react';
import DataGrid from '../components/DataGrid';
import PriceChart from '../components/PriceChart';
import { Input } from '@/components/ui/input';

export default function IndicatorPage() {
  const [groupByQuarter, setGroupByQuarter] = useState(false);
  const [selectedTsCode, setSelectedTsCode] = useState<string>('');

  return (
    <div className="space-y-6">
      {/* 控制面板 */}
      <div className="flex flex-wrap items-center gap-4 p-4 bg-white rounded-lg border border-gray-200">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="groupByQuarter"
            checked={groupByQuarter}
            onChange={(e) => setGroupByQuarter(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
          />
          <label
            htmlFor="groupByQuarter"
            className="text-sm font-medium text-gray-700 cursor-pointer"
          >
            按季分组数据
          </label>
        </div>
        
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
      </div>

      {/* 股价走势图 */}
      {selectedTsCode && (
        <PriceChart tsCode={selectedTsCode} apiPath="/api/parq/indicator" />
      )}

      {/* 数据表格 */}
      <DataGrid 
        category="indicator" 
        title="交易指标"
        useServerPagination={true}
        apiPath="/api/parq/indicator"
        extraQueryParams={groupByQuarter ? { groupByQuarter: true } : {}}
      />
    </div>
  );
}
