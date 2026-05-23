'use client';

import { usePathname } from 'next/navigation';
import { Separator } from '@/components/ui/separator';

const pageTitles: Record<string, string> = {
  '/': '首页',
  '/stockList': '股票列表',
  '/fiIndicator': '财务指标',
  '/indicator': '交易指标',
  '/income1': '利润表',
  '/incomeContrast': '利润对比',
  '/profit': '利润表',
  '/ths_index': '同花顺指数',
  '/industryLink': '产业链分析',
};

export function PageTitle() {
  const pathname = usePathname();
  const title = pageTitles[pathname] || '数据宝';

  return (
    <>
      <Separator orientation="vertical" className="h-4" />
      <h1 className="text-base font-medium">{title}</h1>
    </>
  );
}
