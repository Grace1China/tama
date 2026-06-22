'use client';

import { useEffect, useState } from 'react';

/** 弹窗挂载点：表格/元素全屏时挂到全屏节点，否则挂 body */
export function getModalPortalRoot(): HTMLElement {
  if (typeof document === 'undefined') {
    return null as unknown as HTMLElement;
  }
  const doc = document as Document & { webkitFullscreenElement?: Element | null };
  return (
    (document.fullscreenElement as HTMLElement | null)
    ?? (doc.webkitFullscreenElement as HTMLElement | null)
    ?? document.body
  );
}

export function useModalPortalRoot(): HTMLElement | null {
  const [root, setRoot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const sync = () => setRoot(getModalPortalRoot());
    sync();
    document.addEventListener('fullscreenchange', sync);
    document.addEventListener('webkitfullscreenchange', sync as EventListener);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      document.removeEventListener('webkitfullscreenchange', sync as EventListener);
    };
  }, []);

  return root;
}
