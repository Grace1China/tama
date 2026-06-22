'use client';

import { useEffect, useState } from 'react';
import IndustryChainBoard from './IndustryChainBoard';
import type { IndustryTaxonomyRegistryItem } from './taxonomyRegistryTypes';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

type MarketBreadth = {
  up: number;
  down: number;
  flat: number;
  missing: number;
  total: number;
};

function formatTradeDate(raw: string): string {
  if (!/^\d{8}$/.test(raw)) return raw || '--';
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

export default function IndustryLinkPage() {
  const [taxonomies, setTaxonomies] = useState<IndustryTaxonomyRegistryItem[]>([]);
  const [active, setActive] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [breadthByTaxonomy, setBreadthByTaxonomy] = useState<Record<string, MarketBreadth>>({});
  const [breadthTradeDate, setBreadthTradeDate] = useState('');

  useEffect(() => {
    let alive = true;
    fetch('/api/industry-link/taxonomies')
      .then(async (res) => {
        const payload = (await res.json().catch(() => ({}))) as {
          taxonomies?: IndustryTaxonomyRegistryItem[];
          error?: string;
        };
        if (!res.ok) throw new Error(payload.error ?? `读取产业链列表失败 (${res.status})`);
        return payload.taxonomies ?? [];
      })
      .then((items) => {
        if (!alive) return;
        setTaxonomies(items);
        setActive((prev) => (prev && items.some((item) => item.id === prev) ? prev : items[0]?.id ?? ''));
        setError(null);
      })
      .catch((err) => {
        if (!alive) return;
        setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    fetch('/api/industry-link/market-breadth')
      .then(async (res) => {
        const payload = (await res.json().catch(() => ({}))) as {
          trade_date?: string;
          rows?: Record<string, MarketBreadth>;
          error?: string;
          message?: string;
        };
        if (!res.ok) throw new Error(payload.message ?? payload.error ?? `读取产业链涨跌家数失败 (${res.status})`);
        return payload;
      })
      .then((payload) => {
        if (!alive) return;
        setBreadthByTaxonomy(payload.rows ?? {});
        setBreadthTradeDate(String(payload.trade_date ?? ''));
      })
      .catch((err) => {
        if (!alive) return;
        console.error('读取产业链涨跌家数失败:', err);
        setBreadthByTaxonomy({});
        setBreadthTradeDate('');
      });
    return () => {
      alive = false;
    };
  }, []);

  const activeTaxonomy = taxonomies.find((item) => item.id === active);

  return (
    <div className="flex w-full flex-col gap-2 p-4" style={{ height: 'calc(100vh - 3.5rem)' }}>
      <TooltipProvider delayDuration={150}>
        <div className="flex shrink-0 gap-2 overflow-x-auto px-1 pt-2 pb-1">
          {taxonomies.map((p) => {
            const breadth = breadthByTaxonomy[p.id];
            const button = (
              <Button
                key={p.id}
                variant={active === p.id ? 'default' : 'outline'}
                size="sm"
                className="relative shrink-0 overflow-visible"
                onClick={() => setActive(p.id)}
              >
                {p.label}
                {breadth ? (
                  <span className="absolute -right-1 -top-2 flex h-4 min-w-8 items-center justify-center rounded-full border border-border bg-background px-1 text-[10px] font-semibold leading-none tabular-nums shadow-sm">
                    <span className="text-red-600">{breadth.up}</span>
                    <span className="px-0.5 text-muted-foreground">:</span>
                    <span className="text-green-600">{breadth.down}</span>
                  </span>
                ) : null}
              </Button>
            );

            if (!breadth) return button;
            return (
              <Tooltip key={p.id}>
                <TooltipTrigger asChild>{button}</TooltipTrigger>
                <TooltipContent side="bottom">
                  上涨 {breadth.up} · 下跌 {breadth.down} · 平盘 {breadth.flat} · 缺失 {breadth.missing}
                  <br />
                  数据日期 {formatTradeDate(breadthTradeDate)} · 合计 {breadth.total}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </TooltipProvider>
      <div className="flex-1 min-h-0">
        {error ? (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
            {error}
          </div>
        ) : activeTaxonomy ? (
          <IndustryChainBoard
            key={activeTaxonomy.id}
            taxonomyId={activeTaxonomy.id}
            taxonomyLabel={activeTaxonomy.label}
            defaultYaml={activeTaxonomy.content}
          />
        ) : (
          <div className="rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
            正在读取产业链 YAML...
          </div>
        )}
      </div>
    </div>
  );
}
