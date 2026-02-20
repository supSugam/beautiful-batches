import {
  useState,
  useCallback,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from 'react';

export type SidebarResizeOptions = {
  side?: 'left' | 'right';
  minWidth?: number | ((vw: number) => number);
  maxWidth?: number | ((vw: number) => number);
  defaultFallback?: number;
};

export const useSidebarResize = (
  initialWidth: number,
  onResizeCommit: (width: number) => void,
  options: SidebarResizeOptions = {},
) => {
  const {
    side = 'right',
    minWidth = (vw: number) => Math.max(360, vw * 0.32),
    maxWidth = (vw: number) => vw * 0.94,
    defaultFallback = 360,
  } = options;

  const [isResizing, setIsResizing] = useState(false);
  const [liveWidth, setLiveWidth] = useState(() =>
    Math.max(defaultFallback, initialWidth || defaultFallback),
  );
  const liveWidthRef = useRef(
    Math.max(defaultFallback, initialWidth || defaultFallback),
  );
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
    const minW =
      typeof minWidth === 'function' ? minWidth(window.innerWidth) : minWidth;
    const maxW =
      typeof maxWidth === 'function' ? maxWidth(window.innerWidth) : maxWidth;
    const next = Math.max(
      minW,
      Math.min(
        Math.max(defaultFallback, Number(initialWidth) || defaultFallback),
        maxW,
      ),
    );
    liveWidthRef.current = next;
    setLiveWidth((prev) => (Math.abs(prev - next) < 0.5 ? prev : next));
  }, [initialWidth, isResizing, minWidth, maxWidth, defaultFallback]);

  useEffect(() => {
    if (isResizing) return;
    const minW =
      typeof minWidth === 'function' ? minWidth(window.innerWidth) : minWidth;
    const maxW =
      typeof maxWidth === 'function' ? maxWidth(window.innerWidth) : maxWidth;
    const clamped = Math.max(minW, Math.min(liveWidthRef.current, maxW));
    if (Math.abs(clamped - liveWidthRef.current) < 0.5) return;
    liveWidthRef.current = clamped;
    setLiveWidth(clamped);
    onResizeCommit(Math.round(clamped));
  }, [viewportWidth, isResizing, onResizeCommit, minWidth, maxWidth]);

  useEffect(() => {
    if (!isResizing) return;

    let rafId = 0;
    let latestX: number | null = null;

    const clampWidth = (value: number): number => {
      const minW =
        typeof minWidth === 'function' ? minWidth(window.innerWidth) : minWidth;
      const maxW =
        typeof maxWidth === 'function' ? maxWidth(window.innerWidth) : maxWidth;
      return Math.max(minW, Math.min(value, maxW));
    };

    const doResize = (clientX: number) => {
      const nextWidth = clampWidth(
        side === 'left' ? clientX : window.innerWidth - clientX,
      );
      liveWidthRef.current = nextWidth;
      setLiveWidth((prev) =>
        Math.abs(prev - nextWidth) < 0.5 ? prev : nextWidth,
      );
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
  }, [isResizing, onResizeCommit, side, minWidth, maxWidth]);

  return { isResizing, startResizing, viewportWidth, liveWidth };
};
