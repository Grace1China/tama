import type { Metadata } from 'next'
import './globals.css'
import { SidebarProvider, SidebarInset, SidebarTrigger } from '@/components/ui/sidebar'
import { AppSidebar } from './components/AppSidebar'
import { PageTitle } from './components/PageTitle'

export const metadata: Metadata = {
  title: '数据宝',
  description: '查看和分析财务数据',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="zh-CN">
      <body>
        <SidebarProvider>
          <AppSidebar />
          <SidebarInset className="min-h-0">
            <header className="flex h-14 items-center gap-2 border-b px-4">
              <SidebarTrigger className="-ml-2" />
              <PageTitle />
              <div className="flex-1" />
            </header>
            <main className="flex min-h-0 flex-1 flex-col overflow-auto">
              {children}
            </main>
          </SidebarInset>
        </SidebarProvider>
      </body>
    </html>
  )
}

