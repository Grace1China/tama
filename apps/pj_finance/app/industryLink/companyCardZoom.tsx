'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { ZoomIn, ZoomOut } from 'lucide-react';
import { useStore } from 'reactflow';

import { Button } from '@/components/ui/button';

/** 公司卡片缩放下限 */
export const COMPANY_CARD_ZOOM_MIN = 0.7;
/** 公司卡片缩放上限 */
export const COMPANY_CARD_ZOOM_MAX = 1.6;
/** 每次缩放步进 */
export const COMPANY_CARD_ZOOM_STEP = 0.1;
/** 默认缩放 */
export const COMPANY_CARD_ZOOM_DEFAULT = 1;

export function clampCompanyCardZoom(z: number, snapToStep = false): number {
  const v = snapToStep ? Math.round(z * 10) / 10 : z;
  return Math.min(COMPANY_CARD_ZOOM_MAX, Math.max(COMPANY_CARD_ZOOM_MIN, v));
}

type CompanyCardZoomContextValue = {
  zoom: number;
  zoomIn: () => void;
  zoomOut: () => void;
  setZoom: (z: number) => void;
  canZoomIn: boolean;
  canZoomOut: boolean;
};

const CompanyCardZoomContext = createContext<CompanyCardZoomContextValue | null>(null);

function touchDistance(t1: Touch, t2: Touch): number {
  return Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
}

/** Safari / WebKit pinch 手势事件 */
type WebKitGestureEvent = Event & { scale: number };

/**
 * 挂载在 React Flow 内部：双指 touch pinch、Safari gesture、触控板 Ctrl/⌘+滚轮。
 * 仅更新公司卡片 zoom，泳道视口 zoom 不变。
 */
export function CompanyCardGestureZoom() {
  const domNode = useStore((s) => s.domNode);
  const ctx = useContext(CompanyCardZoomContext);
  const pinchRef = useRef<{ startDist: number; startZoom: number } | null>(null);
  const gestureRef = useRef<{ startZoom: number } | null>(null);
  const zoomRef = useRef(COMPANY_CARD_ZOOM_DEFAULT);
  const setZoomRef = useRef<(z: number) => void>(() => {});

  zoomRef.current = ctx?.zoom ?? COMPANY_CARD_ZOOM_DEFAULT;
  setZoomRef.current = ctx?.setZoom ?? (() => {});

  useEffect(() => {
    if (!(domNode instanceof HTMLElement)) return undefined;

    const applyZoom = (z: number) => {
      setZoomRef.current(clampCompanyCardZoom(z));
    };

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 2) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      pinchRef.current = {
        startDist: touchDistance(e.touches[0], e.touches[1]),
        startZoom: zoomRef.current,
      };
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !pinchRef.current) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const dist = touchDistance(e.touches[0], e.touches[1]);
      const ratio = dist / pinchRef.current.startDist;
      applyZoom(pinchRef.current.startZoom * ratio);
    };

    const clearPinch = (e: TouchEvent) => {
      if (e.touches.length < 2) pinchRef.current = null;
    };

    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gestureRef.current = { startZoom: zoomRef.current };
    };

    const onGestureChange = (e: Event) => {
      e.preventDefault();
      const ge = e as WebKitGestureEvent;
      if (!gestureRef.current) return;
      applyZoom(gestureRef.current.startZoom * ge.scale);
    };

    const onGestureEnd = (e: Event) => {
      e.preventDefault();
      gestureRef.current = null;
    };

    /** 触控板双指 pinch 在桌面浏览器通常表现为 ctrlKey/metaKey + wheel */
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      const factor = Math.exp(-e.deltaY * 0.002);
      applyZoom(zoomRef.current * factor);
    };

    const opts = { passive: false, capture: true } as const;
    domNode.addEventListener('touchstart', onTouchStart, opts);
    domNode.addEventListener('touchmove', onTouchMove, opts);
    domNode.addEventListener('touchend', clearPinch, opts);
    domNode.addEventListener('touchcancel', clearPinch, opts);
    domNode.addEventListener('gesturestart', onGestureStart, opts);
    domNode.addEventListener('gesturechange', onGestureChange, opts);
    domNode.addEventListener('gestureend', onGestureEnd, opts);
    domNode.addEventListener('wheel', onWheel, opts);

    return () => {
      domNode.removeEventListener('touchstart', onTouchStart, opts);
      domNode.removeEventListener('touchmove', onTouchMove, opts);
      domNode.removeEventListener('touchend', clearPinch, opts);
      domNode.removeEventListener('touchcancel', clearPinch, opts);
      domNode.removeEventListener('gesturestart', onGestureStart, opts);
      domNode.removeEventListener('gesturechange', onGestureChange, opts);
      domNode.removeEventListener('gestureend', onGestureEnd, opts);
      domNode.removeEventListener('wheel', onWheel, opts);
    };
  }, [domNode]);

  return null;
}

/** 公司卡片缩放状态；不影响泳道与画布视口 zoom */
export function CompanyCardZoomProvider({ children }: { children: React.ReactNode }) {
  const [zoom, setZoomState] = useState(COMPANY_CARD_ZOOM_DEFAULT);

  const setZoom = useCallback((z: number) => {
    setZoomState(clampCompanyCardZoom(z));
  }, []);

  const zoomIn = useCallback(() => {
    setZoomState((z) => clampCompanyCardZoom(z + COMPANY_CARD_ZOOM_STEP, true));
  }, []);

  const zoomOut = useCallback(() => {
    setZoomState((z) => clampCompanyCardZoom(z - COMPANY_CARD_ZOOM_STEP, true));
  }, []);

  const value = useMemo(
    (): CompanyCardZoomContextValue => ({
      zoom,
      zoomIn,
      zoomOut,
      setZoom,
      canZoomIn: zoom < COMPANY_CARD_ZOOM_MAX - 1e-6,
      canZoomOut: zoom > COMPANY_CARD_ZOOM_MIN + 1e-6,
    }),
    [zoom, zoomIn, zoomOut, setZoom],
  );

  return (
    <CompanyCardZoomContext.Provider value={value}>{children}</CompanyCardZoomContext.Provider>
  );
}

export function useCompanyCardZoomScale(): number {
  return useContext(CompanyCardZoomContext)?.zoom ?? COMPANY_CARD_ZOOM_DEFAULT;
}

/** 画布右下角：仅缩放公司卡片 */
export function CompanyCardZoomControls() {
  const ctx = useContext(CompanyCardZoomContext);
  if (!ctx) return null;

  const { zoom, zoomIn, zoomOut, canZoomIn, canZoomOut } = ctx;
  const label = `${Math.round(zoom * 100)}%`;

  return (
    <div
      className="pointer-events-auto absolute bottom-3 right-3 z-10 flex items-center gap-1 rounded-md border border-border bg-background/95 p-1 shadow-sm backdrop-blur-sm"
      aria-label="公司卡片缩放"
    >
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-8 w-8"
        onClick={zoomOut}
        disabled={!canZoomOut}
        aria-label="缩小公司卡片"
        title="缩小公司卡片"
      >
        <ZoomOut />
      </Button>
      <span className="min-w-[3rem] select-none text-center text-xs tabular-nums text-muted-foreground">
        {label}
      </span>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-8 w-8"
        onClick={zoomIn}
        disabled={!canZoomIn}
        aria-label="放大公司卡片"
        title="放大公司卡片"
      >
        <ZoomIn />
      </Button>
    </div>
  );
}
