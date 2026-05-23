'use client';

import IndustryChainBoard from './IndustryChainBoard';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

export default function IndustryLinkPage() {
  return (
    /* 不向纵向拉伸占满 viewport，避免出现 Tab 与内容之间大块空白；自上而下靠顶排版 */
    <div className="flex w-full flex-col gap-2 p-4">
      <Tabs defaultValue="lithium" className="flex w-full flex-col">
        {/* 产业链类型切换 */}
        <TabsList className="h-10 w-fit max-w-full shrink-0 flex-wrap gap-1">
          <TabsTrigger value="lithium">锂电池产业链</TabsTrigger>
          <TabsTrigger value="ai">AI 产业</TabsTrigger>
          <TabsTrigger value="ai_compute">AI算力产业链</TabsTrigger>
        </TabsList>
        <TabsContent value="lithium" className="w-full flex flex-col">
          <IndustryChainBoard preset="lithium" />
        </TabsContent>
        <TabsContent value="ai" className="w-full flex flex-col">
          <IndustryChainBoard preset="ai" />
        </TabsContent>
        <TabsContent value="ai_compute" className="w-full flex flex-col">
          <IndustryChainBoard preset="ai_compute" />
        </TabsContent>
      </Tabs>
    </div>
  );
}
