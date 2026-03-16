import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';

type ExportResizeSectionProps = {
  outputWidth: number | null;
  handleResizeToggle: () => void;
  manualOutputWidth: string | number;
  handleOutputWidthChange: (value: string) => void;
  handleOutputWidthBlur: () => void;
  aspect: number | null;
  currentPixelWidth: number;
  currentPixelHeight: number;
  showSectionLabel?: boolean;
};

const ExportResizeSection = ({
  outputWidth,
  handleResizeToggle,
  manualOutputWidth,
  handleOutputWidthChange,
  handleOutputWidthBlur,
  aspect,
  currentPixelWidth,
  currentPixelHeight,
  showSectionLabel = true,
}: ExportResizeSectionProps) => {
  const PIN_TO_BOTTOM_MS_OPEN = 220;
  const sectionRef = useRef<HTMLElement | null>(null);
  const stopAutoScrollRef = useRef<(() => void) | null>(null);
  const bodyInnerRef = useRef<HTMLDivElement | null>(null);
  const heightRafRef = useRef(0);
  const contentHeightRef = useRef(0);
  const [contentHeight, setContentHeight] = useState(0);
  const isOpen = outputWidth !== null;

  const commitContentHeight = () => {
    const el = bodyInnerRef.current;
    if (!el) return;
    const next = Math.max(
      0,
      Math.ceil(Math.max(el.getBoundingClientRect().height, el.scrollHeight)),
    );
    if (next === contentHeightRef.current) return;
    contentHeightRef.current = next;
    setContentHeight(next);
  };

  const findScrollParent = (node: HTMLElement | null): HTMLElement | null => {
    let el: HTMLElement | null = node;
    while (el) {
      const style = window.getComputedStyle(el);
      const overflowY = style.overflowY;
      const canScroll =
        overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
      if (canScroll) return el;
      el = el.parentElement;
    }
    return null;
  };

  const startPinToBottomLoop = (ms: number) => {
    const el = sectionRef.current;
    const scrollEl =
      findScrollParent(el) ||
      (el?.closest?.('.inspector-scroll') as HTMLElement | null);
    if (!el || !scrollEl) return null;

    let stopped = false;
    let raf = 0;
    const t0 = performance.now();

    const stop = () => {
      stopped = true;
      if (raf) window.cancelAnimationFrame(raf);
      raf = 0;
      scrollEl.removeEventListener('wheel', stop, { capture: true } as any);
      scrollEl.removeEventListener('touchmove', stop, { capture: true } as any);
      window.removeEventListener('keydown', stop, { capture: true } as any);
    };

    const tick = () => {
      raf = 0;
      if (stopped) return;
      const max = scrollEl.scrollHeight - scrollEl.clientHeight;
      if (Math.abs(scrollEl.scrollTop - max) > 1) {
        scrollEl.scrollTop = max;
      }
      if (performance.now() - t0 > ms) return;
      raf = window.requestAnimationFrame(tick);
    };

    // Export is the last section: always pin to the absolute bottom while revealing.
    tick();
    scrollEl.addEventListener('wheel', stop, { capture: true, passive: true } as any);
    scrollEl.addEventListener('touchmove', stop, { capture: true, passive: true } as any);
    window.addEventListener('keydown', stop, { capture: true } as any);
    return stop;
  };

  useLayoutEffect(() => {
    commitContentHeight();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = bodyInnerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver(() => {
      if (heightRafRef.current) return;
      heightRafRef.current = window.requestAnimationFrame(() => {
        heightRafRef.current = 0;
        commitContentHeight();
      });
    });

    observer.observe(el);
    return () => {
      try {
        observer.disconnect();
      } catch {}
      if (heightRafRef.current) {
        window.cancelAnimationFrame(heightRafRef.current);
        heightRafRef.current = 0;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const el = bodyInnerRef.current;
    if (!el) return;
    if (!isOpen) el.setAttribute('inert', '');
    else el.removeAttribute('inert');
    return () => {
      try {
        el.removeAttribute('inert');
      } catch {}
    };
  }, [isOpen]);

  useEffect(() => {
    stopAutoScrollRef.current?.();
    stopAutoScrollRef.current = null;

    if (isOpen) {
      // Only pin on reveal. On collapse, letting the scroll container clamp naturally
      // avoids the "fight" that can feel jittery.
      stopAutoScrollRef.current = startPinToBottomLoop(PIN_TO_BOTTOM_MS_OPEN);
    }

    return () => {
      stopAutoScrollRef.current?.();
      stopAutoScrollRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  return (
    <section ref={sectionRef} className="control-section">
      <div className="section-header">
        {showSectionLabel ? (
          <h3 className="section-label">Export Resize</h3>
        ) : (
          <h4 className="subsection-label">Resize</h4>
        )}
        <label className="metadata-checkbox-row">
          <input
            type="checkbox"
            className="metadata-checkbox-input"
            checked={outputWidth !== null}
            onChange={handleResizeToggle}
            aria-label="Enable/Disable Resize"
          />
          <span className="metadata-checkbox-indicator" aria-hidden="true">
            <svg
              className="metadata-checkbox-mark"
              viewBox="0 0 24 24"
              fill="none"
              style={{ transform: 'scale(1.2)' }}
            >
              <path
                className="metadata-checkbox-mark-path"
                d="M5 12l4.5 4.5L19 7"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </label>
      </div>

      <motion.div
        initial={false}
        animate={{
          opacity: isOpen ? 1 : 0,
          height: isOpen ? contentHeight : 0,
        }}
        transition={{
          height: {
            duration: isOpen ? 0.18 : 0.24,
            ease: isOpen ? 'easeOut' : 'easeInOut',
          },
          opacity: { duration: isOpen ? 0.14 : 0.12, ease: 'easeOut' },
        }}
        style={{
          overflow: 'hidden',
          pointerEvents: isOpen ? 'auto' : 'none',
          willChange: 'height, opacity, transform',
        }}
      >
        <div ref={bodyInnerRef} aria-hidden={!isOpen}>
          <div className="dims-grid">
            <div className="dim-input-group">
              <label>W</label>
              <input
                type="number"
                value={manualOutputWidth !== '' ? manualOutputWidth : outputWidth || ''}
                onChange={(e) => handleOutputWidthChange(e.target.value)}
                onBlur={handleOutputWidthBlur}
                onKeyDown={(e) => e.stopPropagation()}
              />
            </div>
            <div className="dim-link-icon">
              <span style={{ fontSize: 10, opacity: 0.5 }}>×</span>
            </div>
            <div className="dim-input-group disabled">
              <label>H</label>
              <input
                type="number"
                disabled
                value={(() => {
                  const ratio = aspect || currentPixelWidth / currentPixelHeight;
                  const w = outputWidth ?? 0;
                  return Math.round(w / ratio) || 0;
                })()}
              />
            </div>
          </div>
        </div>
      </motion.div>
    </section>
  );
};

export default React.memo(ExportResizeSection);
