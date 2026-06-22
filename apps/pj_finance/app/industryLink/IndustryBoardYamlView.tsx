'use client';

import React, { useCallback, useRef } from 'react';
import { RotateCcw, Save } from 'lucide-react';

import { Button } from '@/components/ui/button';

/** 产业链图形配置 YAML 编辑器 */
export default function IndustryBoardYamlEditor({
  yamlText,
  heightCss,
  onDraftChange,
  onApply,
  onReset,
  parseError,
  pendingApply,
  saving,
}: {
  yamlText: string;
  heightCss: string;
  onDraftChange: (next: string) => void;
  onApply: () => void | Promise<void>;
  onReset: () => void;
  parseError?: string | null;
  /** 草稿已改、尚未应用 */
  pendingApply?: boolean;
  /** 正在保存 YAML 到文件 */
  saving?: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        onApply();
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        const el = e.currentTarget;
        const start = el.selectionStart;
        const end = el.selectionEnd;
        const insert = '  ';
        const next = yamlText.slice(0, start) + insert + yamlText.slice(end);
        onDraftChange(next);
        requestAnimationFrame(() => {
          el.selectionStart = el.selectionEnd = start + insert.length;
        });
      }
    },
    [onApply, onDraftChange, yamlText],
  );

  return (
    <div
      style={{ height: heightCss }}
      className="relative flex min-h-[420px] w-full flex-col overflow-hidden rounded-md border border-border bg-muted/20"
    >
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-background/80 px-3 py-2">
        <Button type="button" size="sm" onClick={onApply} disabled={saving} className="h-8 gap-1.5">
          <Save className="size-3.5" />
          {saving ? '保存中…' : '应用到图形'}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onReset} className="h-8 gap-1.5">
          <RotateCcw className="size-3.5" />
          重置
        </Button>
        <span className="text-xs text-muted-foreground">
          {parseError ? (
            <span className="text-destructive">{parseError}</span>
          ) : saving ? (
            '正在保存 YAML 文件…'
          ) : pendingApply ? (
            '有未应用的修改（⌘/Ctrl + S 应用）'
          ) : (
            '已同步到图形视图并保存 YAML 文件'
          )}
        </span>
      </div>
      <p className="shrink-0 border-b border-border px-4 py-2 text-xs leading-relaxed text-muted-foreground">
        支持两种泳道写法：
        <strong className="font-medium text-foreground">扁平</strong>
        <code className="mx-1 rounded bg-muted px-1">子泳道: [公司…]</code>
        ；
        <strong className="font-medium text-foreground">两层嵌套</strong>
        <code className="mx-1 rounded bg-muted px-1">根泳道: {'{ 子泳道: [公司…] }'}</code>
        或子泳道带说明
        <code className="mx-1 rounded bg-muted px-1">{'{ 产业位置, 确定性, 弹性, 弹性因子, 公司: […] }'}</code>
        （根名显示在条带上方）。公司下用
        <code className="mx-1 rounded bg-muted px-1">link</code>
        /
        <code className="mx-1 rounded bg-muted px-1">info</code>
        配置关联与详情；应用后写入 YAML 并刷新图形。
      </p>
      <textarea
        ref={textareaRef}
        value={yamlText}
        onChange={(e) => onDraftChange(e.target.value)}
        onKeyDown={handleKeyDown}
        spellCheck={false}
        className="min-h-0 flex-1 w-full resize-none border-0 bg-transparent p-4 font-mono text-xs leading-relaxed text-foreground outline-none focus-visible:ring-0"
        aria-label="产业链图形配置 YAML"
      />
    </div>
  );
}
