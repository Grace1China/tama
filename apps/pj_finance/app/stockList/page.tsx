'use client';

import DataGrid from '../components/DataGrid';

export default function StockListPage() {
  return (
    <DataGrid 
      category="stockList" 
      title="股票列表"
      useServerPagination={false}
    />
  );
}
