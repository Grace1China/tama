'use client';

import DataGrid from '../components/DataGrid';

export default function FiIndicatorPage() {
  return (
    <DataGrid 
      category="fiIndicator" 
      title="财务指标"
      useServerPagination={true}
    />
  );
}
