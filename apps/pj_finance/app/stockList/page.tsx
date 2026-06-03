'use client';

import { useState, useEffect, useMemo } from 'react';
import DataGrid, { type CSVData } from '../components/DataGrid';
import SparkLine from '../components/SparkLine';

function KlineCellRenderer(params: any) {
  const tsCode = params.value;
  if (!tsCode) return <span className="text-[10px] text-gray-300">—</span>;
  return <SparkLine tsCode={tsCode} width={150} height={48} />;
}

export default function StockListPage() {
  const [rawData, setRawData] = useState<CSVData | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/csv/stockList?page=1&size=10000')
      .then((r) => r.json())
      .then((json) => {
        if (!cancelled) setRawData(json);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  const localData = useMemo(() => {
    if (!rawData) return null;
    return {
      ...rawData,
      originalHeaders: [...(rawData.originalHeaders || []), '_kline'],
      data: rawData.data.map((row: any) => ({
        ...row,
        _kline: row.ts_code,
      })),
    };
  }, [rawData]);

  if (!localData) {
    return (
      <div className="flex items-center justify-center h-96">
        <p className="text-gray-500">加载中...</p>
      </div>
    );
  }

  return (
    <DataGrid
      category="stockList"
      title="股票列表"
      useServerPagination={false}
      localData={localData}
      columnOrder={['ts_code', 'symbol', 'name', '_kline']}
      fieldLabelMap={{ _kline: 'K线' }}
      customCellRenderers={{ _kline: KlineCellRenderer }}
      columnWidthByField={{ _kline: 200 }}
      rowHeight={52}
      cellStyleByField={{ _kline: { display: 'flex', alignItems: 'center', overflow: 'visible' } }}
    />
  );
}
