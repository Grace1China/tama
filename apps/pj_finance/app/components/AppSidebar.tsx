'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  List,
  Calculator,
  TrendingUp,
  FileText,
  BarChart3,
  Database,
  FileSpreadsheet,
} from 'lucide-react';

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar';

const categories = [
  { id: 'stockList', name: '股票列表', path: '/stockList', icon: List },
  { id: 'fiIndicator', name: '财务指标', path: '/fiIndicator', icon: Calculator },
  { id: 'indicator', name: '交易指标', path: '/indicator', icon: TrendingUp },
  { id: 'profit', name: '利润表', path: '/profit', icon: FileText },
  { id: 'income1', name: '利润表1', path: '/income1', icon: FileText },
  { id: 'balanceSheet', name: '资产负债表', path: '/balanceSheet', icon: FileSpreadsheet },
  { id: 'ths_index', name: '同花顺指数', path: '/ths_index', icon: BarChart3 },
];

export function AppSidebar() {
  const pathname = usePathname();

  return (
    <Sidebar>
      <SidebarHeader className="border-b border-sidebar-border">
        <Link href="/" className="flex items-center gap-2 px-2 py-2">
          <Database className="h-6 w-6 text-primary" />
          <span className="text-lg font-semibold">数据宝</span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>数据模块</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {categories.map((category) => (
                <SidebarMenuItem key={category.id}>
                  <SidebarMenuButton
                    asChild
                    isActive={pathname === category.path}
                    tooltip={category.name}
                  >
                    <Link href={category.path}>
                      <category.icon className="h-4 w-4" />
                      <span>{category.name}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
