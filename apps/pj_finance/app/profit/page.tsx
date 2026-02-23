'use client';

import DataGrid from '../components/DataGrid';

export default function ProfitPage() {
  return (
    <DataGrid 
      category="profit" 
      title="利润表"
      useServerPagination={true}
    />
  );
}
