import {
  useState,
  useCallback,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from 'react';

export const useSidebarResize = (
  initialWidth: number,
  onResizeCommit: (width: number) => void,
) => {
  const [isResizing, setIsResizing] = useState(false);
  const [liveWidth, setLiveWidth] = useState(() => Math.max(360, initialWidth || 360));
  const liveWidthRef = useRef(Math.max(360, initialWidth || 360));
  const [viewportWidth, setViewportWidth] = useState(() =>
    Math.max(1, typeof window !== 'undefined' ? window.innerWidth : 1440),
  );

  const startResizing = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    const onWindowResize = () => {
      setViewportWidth(Math.max(1, window.innerWidth || 1));
    };

    window.addEventListener('resize', onWindowResize);
    return () => window.removeEventListener('resize', onWindowResize);
  }, []);

  useEffect(() => {
    if (isResizing) return;
    const minW = Math.max(360, window.innerWidth * 0.32);
    const maxW = window.innerWidth * 0.94;
    const next = Math.max(minW, Math.min(Math.max(360, Number(initialWidth) || 360), maxW));
    liveWidthRef.current = next;
    setLiveWidth((prev) => (Math.abs(prev - next) < 0.5 ? prev : next));
  }, [initialWidth, isResizing]);

  useEffect(() => {
    if (isResizing) return;
    const minW = Math.max(360, window.innerWidth * 0.32);
    const maxW = window.innerWidth * 0.94;
    const clamped = Math.max(minW, Math.min(liveWidthRef.current, maxW));
    if (Math.abs(clamped - liveWidthRef.current) < 0.5) return;
    liveWidthRef.current = clamped;
    setLiveWidth(clamped);
    onResizeCommit(Math.round(clamped));
  }, [viewportWidth, isResizing, onResizeCommit]);

  useEffect(() => {
    if (!isResizing) return;

    let rafId = 0;
    let latestX: number | null = null;

    const clampWidth = (value: number): number => {
      const minW = Math.max(360, window.innerWidth * 0.32);
      const maxW = window.innerWidth * 0.94;
      return Math.max(minW, Math.min(value, maxW));
    };

    const doResize = (clientX: number) => {
      const nextWidth = clampWidth(window.innerWidth - clientX);
      liveWidthRef.current = nextWidth;
      setLiveWidth((prev) => (Math.abs(prev - nextWidth) < 0.5 ? prev : nextWidth));
    };

    const handlePointerMove = (e: PointerEvent) => {
      latestX = e.clientX;
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        if (latestX === null) return;
        doResize(latestX);
      });
    };

    const stopResize = () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
      setIsResizing(false);
      const committedWidth = Math.round(clampWidth(liveWidthRef.current));
      liveWidthRef.current = committedWidth;
      setLiveWidth(committedWidth);
      onResizeCommit(committedWidth);
      document.body.style.cursor = 'default';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResize);
    window.addEventListener('pointercancel', stopResize);

    return () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
      }
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResize);
      window.removeEventListener('pointercancel', stopResize);
      document.body.style.userSelect = '';
    };
  }, [isResizing, onResizeCommit]);

  return { isResizing, startResizing, viewportWidth, liveWidth };
};
