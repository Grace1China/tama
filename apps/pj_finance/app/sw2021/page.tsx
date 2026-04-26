'use client';

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import DataGrid from '../components/DataGrid';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

type Level = 'L1' | 'L2' | 'L3';

type TreeNode = {
  indexCode: string;
  industryCode: string;
  parentCode: string;
  name: string;
  level: Level;
  memberCount: number;
  children: TreeNode[];
};

function nodeKey(node: TreeNode): string {
  return `${node.level}-${node.industryCode}-${node.indexCode}`;
}

export default function Sw2021Page() {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedNode, setSelectedNode] = useState<TreeNode | null>(null);
  const [activeTab, setActiveTab] = useState('daily');

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch('/api/parq/sw2021/tree');
        if (!res.ok) throw new Error(await res.text());
        const json = await res.json();
        if (cancelled) return;
        const nextTree = Array.isArray(json?.tree) ? (json.tree as TreeNode[]) : [];
        setTree(nextTree);
        if (nextTree.length > 0) {
          setExpanded(new Set(nextTree.map((n) => nodeKey(n))));
        }
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : '加载申万行业树失败');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedTitle = useMemo(() => {
    if (!selectedNode) return '未选择分类';
    return `${selectedNode.name} (${selectedNode.level})`;
  }, [selectedNode]);

  const renderNode = (node: TreeNode, depth = 0) => {
    const key = nodeKey(node);
    const hasChildren = node.children.length > 0;
    const isExpanded = expanded.has(key);
    const isSelected = selectedNode ? nodeKey(selectedNode) === key : false;

    return (
      <div key={key}>
        <div
          className={`flex items-center gap-1 rounded px-1 py-1 text-sm ${
            isSelected ? 'bg-blue-50 text-blue-700' : 'hover:bg-gray-50'
          }`}
          style={{ paddingLeft: `${depth * 14 + 4}px` }}
        >
          <button
            type="button"
            disabled={!hasChildren}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (!hasChildren) return;
              setExpanded((prev) => {
                const next = new Set(prev);
                if (next.has(key)) next.delete(key);
                else next.add(key);
                return next;
              });
            }}
            className="h-5 w-5 shrink-0 rounded text-gray-500 hover:bg-gray-100 disabled:opacity-40"
            aria-label={isExpanded ? '收起' : '展开'}
          >
            {hasChildren ? (isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />) : <span className="inline-block w-4" />}
          </button>
          <button
            type="button"
            onClick={() => setSelectedNode(node)}
            className="min-w-0 flex-1 truncate text-left"
            title={`${node.name} ${node.indexCode}`}
          >
            <span className="font-medium">{node.name}</span>
            <span className="ml-1 text-xs text-gray-500">{node.indexCode}</span>
            <span className="ml-1 text-xs text-gray-400">({node.memberCount})</span>
          </button>
        </div>
        {hasChildren && isExpanded && (
          <div>{node.children.map((child) => renderNode(child, depth + 1))}</div>
        )}
      </div>
    );
  };

  return (
    <div className="box-border flex h-[calc(100vh-3.5rem)] min-h-0 flex-col gap-4 overflow-hidden p-4">
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <h1 className="text-lg font-semibold text-gray-900">申万行业分类2021</h1>
        <p className="mt-1 text-sm text-gray-500">
          左侧选择 L1/L2/L3 任一分类，右侧查看该分类指数日线和成分股。
        </p>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border border-gray-200 bg-white">
        <aside className="w-[360px] shrink-0 border-r border-gray-100">
          <div className="border-b border-gray-100 px-3 py-2 text-sm font-semibold text-gray-800">行业树</div>
          <div className="h-[calc(100%-2.25rem)] overflow-auto px-2 py-2">
            {loading && <div className="px-2 py-3 text-sm text-gray-500">加载中...</div>}
            {error && <div className="px-2 py-3 text-sm text-red-500">{error}</div>}
            {!loading && !error && tree.length === 0 && <div className="px-2 py-3 text-sm text-gray-500">暂无行业分类数据</div>}
            {!loading && !error && tree.map((node) => renderNode(node))}
          </div>
        </aside>

        <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="border-b border-gray-100 px-4 py-3 text-sm text-gray-700">
            当前分类：<span className="font-medium text-gray-900">{selectedTitle}</span>
          </div>

          {!selectedNode ? (
            <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-gray-400">
              请先从左侧行业树选择一个分类节点。
            </div>
          ) : (
            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="border-b border-gray-100 px-4 pt-3">
                <TabsList>
                  <TabsTrigger value="daily">指数数据</TabsTrigger>
                  <TabsTrigger value="members">成员</TabsTrigger>
                </TabsList>
              </div>

              <div className="flex min-h-0 flex-1 overflow-hidden p-3">
                {activeTab === 'daily' ? (
                  <DataGrid
                    category="sw2021_daily"
                    tabId="sw2021_daily_tab_v2"
                    title="申万指数日线"
                    tightChrome
                    useServerPagination
                    apiPath="/api/parq/sw2021/daily"
                    extraQueryParams={{ ts_code: selectedNode.indexCode }}
                    gridHeight="100%"
                  />
                ) : (
                  <DataGrid
                    category="sw2021_members"
                    tabId="sw2021_members_tab_v2"
                    title="申万指数成员"
                    tightChrome
                    useServerPagination
                    apiPath="/api/parq/sw2021/members"
                    extraQueryParams={{ level: selectedNode.level, code: selectedNode.indexCode }}
                    gridHeight="100%"
                  />
                )}
              </div>
            </Tabs>
          )}
        </section>
      </div>
    </div>
  );
}

