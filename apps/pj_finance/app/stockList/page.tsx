'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import DataGrid, { type CSVData } from '../components/DataGrid';
import SparkLine from '../components/SparkLine';
import KLineModal from '../components/KLineModal';

export default function StockListPage() {
  const [rawData, setRawData] = useState<CSVData | null>(null);
  const [klineStock, setKlineStock] = useState<{ tsCode: string; name: string } | null>(null);

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

  const handleOpenKline = useCallback((tsCode: string, name: string) => {
    setKlineStock({ tsCode, name });
  }, []);

  const handleCloseKline = useCallback(() => {
    setKlineStock(null);
  }, []);

  const TsCodeRenderer = useCallback(
    ({ value, data }: any) => {
      const code = value ?? data?.ts_code ?? '';
      if (!code) return <span className="text-gray-300">—</span>;
      return (
        <button
          type="button"
          className="text-blue-600 hover:text-blue-800 hover:underline text-left cursor-pointer bg-transparent border-none p-0"
          onClick={() => handleOpenKline(code, data?.name ?? '')}
        >
          {code}
        </button>
      );
    },
    [handleOpenKline]
  );

  const NameRenderer = useCallback(
    ({ value, data }: any) => {
      const name = value ?? data?.name ?? '';
      const code = data?.ts_code ?? '';
      if (!name) return <span className="text-gray-300">—</span>;
      return (
        <button
          type="button"
          className="text-blue-600 hover:text-blue-800 hover:underline text-left cursor-pointer bg-transparent border-none p-0"
          onClick={() => handleOpenKline(code, name)}
        >
          {name}
        </button>
      );
    },
    [handleOpenKline]
  );

  const KlineRenderer = useCallback(
    ({ value }: any) => {
      if (!value) return null;
      return <SparkLine tsCode={String(value)} width={150} height={48} />;
    },
    []
  );

  const customCellRenderers = useMemo(
    () => ({
      ts_code: TsCodeRenderer,
      name: NameRenderer,
      _kline: KlineRenderer,
    }),
    [TsCodeRenderer, NameRenderer, KlineRenderer]
  );

  if (!localData) {
    return (
      <div className="flex items-center justify-center h-96">
        <p className="text-gray-500">加载中...</p>
      </div>
    );
  }

  return (
    <>
      <DataGrid
        category="stockList"
        title="股票列表"
        useServerPagination={false}
        localData={localData}
        columnOrder={['ts_code', 'symbol', 'name', '_kline']}
        fieldLabelMap={{ _kline: 'K线' }}
        customCellRenderers={customCellRenderers}
        columnWidthByField={{ ts_code: 120, name: 120, _kline: 200 }}
        rowHeight={52}
        cellStyleByField={{ _kline: { display: 'flex', alignItems: 'center', overflow: 'visible' } }}
      />

      {klineStock && (
        <KLineModal
          open={true}
          tsCode={klineStock.tsCode}
          stockName={klineStock.name}
          onClose={handleCloseKline}
        />
      )}
    </>
  );
}
