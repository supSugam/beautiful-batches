import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeftCircle, ArrowRightCircle, Zap, ChevronDown, Sparkles, Copy } from 'lucide-react';
import type { ApplyCropToImagesOptions } from '../../../types/app';
import SegmentedControl from '../../common/SegmentedControl';

type BulkApplySectionProps = {
  onApplyTo: (
    target: 'prev' | 'rest' | 'all',
    options?: ApplyCropToImagesOptions,
  ) => void;
  showSectionLabel?: boolean;
  canIncludeWatermarkRemoval?: boolean;
  canIncludeBackgroundRemoval?: boolean;
};

const REVEAL_SECTION_TRANSITION = { duration: 0.22, ease: 'easeOut' } as const;
const PIN_TO_BOTTOM_MS = 260;

const BulkApplySection = ({
  onApplyTo,
  showSectionLabel = true,
  canIncludeWatermarkRemoval = false,
  canIncludeBackgroundRemoval = false,
}: BulkApplySectionProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const sectionRef = useRef<HTMLElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const bodyInnerRef = useRef<HTMLDivElement | null>(null);
  const heightRafRef = useRef(0);
  const contentHeightRef = useRef(0);
  const [contentHeight, setContentHeight] = useState(0);
  const stopAutoScrollRef = useRef<(() => void) | null>(null);
  const [includeCaption, setIncludeCaption] = useState(false);
  const [includeTransforms, setIncludeTransforms] = useState(true);
  const [includeCropState, setIncludeCropState] = useState(true);
  const [includeUiTweaks, setIncludeUiTweaks] = useState(true);
  const [includeWatermarkRemoval, setIncludeWatermarkRemoval] = useState(false);
  const [includeBackgroundRemoval, setIncludeBackgroundRemoval] = useState(false);
  const [includeDetectionRegion, setIncludeDetectionRegion] = useState(true);
  const [captionMode, setCaptionMode] = useState<'copy' | 'ai'>('copy');

  useEffect(() => {
    return () => {
      stopAutoScrollRef.current?.();
      stopAutoScrollRef.current = null;
      if (heightRafRef.current) {
        window.cancelAnimationFrame(heightRafRef.current);
        heightRafRef.current = 0;
      }
    };
  }, []);

  const commitContentHeight = () => {
    const el = bodyInnerRef.current;
    if (!el) return;
    // Round to avoid sub-pixel jitter, especially in webviews.
    const next = Math.max(
      0,
      Math.ceil(Math.max(el.getBoundingClientRect().height, el.scrollHeight)),
    );
    if (next === contentHeightRef.current) return;
    contentHeightRef.current = next;
    setContentHeight(next);
  };

  // Measure on mount so open can animate to the correct height.
  useLayoutEffect(() => {
    commitContentHeight();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep content height in sync (toggles can change body height).
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

  // Prevent hidden controls from being tabbable while collapsed (where supported).
  useEffect(() => {
    const el = bodyInnerRef.current;
    if (!el) return;
    if (!isOpen) {
      el.setAttribute('inert', '');
    } else {
      el.removeAttribute('inert');
    }
    return () => {
      try {
        el.removeAttribute('inert');
      } catch {}
    };
  }, [isOpen]);

  const findScrollParent = (node: HTMLElement | null): HTMLElement | null => {
    let el: HTMLElement | null = node;
    while (el) {
      const style = window.getComputedStyle(el);
      const overflowY = style.overflowY;
      const canScroll =
        overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
      if (canScroll) {
        return el;
      }
      el = el.parentElement;
    }
    return null;
  };

  const startPinToBottomLoop = () => {
    const el = sectionRef.current;
    const scrollEl =
      findScrollParent(el) ||
      (el?.closest?.('.inspector-scroll') as HTMLElement | null);
    if (!scrollEl) return null;

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
      if (performance.now() - t0 > PIN_TO_BOTTOM_MS) return;
      raf = window.requestAnimationFrame(tick);
    };

    // If user interacts, stop immediately.
    scrollEl.addEventListener('wheel', stop, { capture: true, passive: true } as any);
    scrollEl.addEventListener('touchmove', stop, { capture: true, passive: true } as any);
    window.addEventListener('keydown', stop, { capture: true } as any);
    tick();
    return stop;
  };

  const apply = (target: 'prev' | 'rest' | 'all') =>
    onApplyTo(target, {
      includeCaption,
      captionMode,
      includeTransforms,
      includeCropState,
      includeUiTweaks,
      includeWatermarkRemoval: canIncludeWatermarkRemoval
        ? includeWatermarkRemoval
        : false,
      includeBackgroundRemoval: canIncludeBackgroundRemoval
        ? includeBackgroundRemoval
        : false,
      includeDetectionRegion,
    });

  return (
    <section ref={sectionRef} className="control-section">
      <div 
        className="section-header" 
        onClick={() => setIsOpen(!isOpen)}
        style={{ cursor: 'pointer' }}
      >
        {showSectionLabel ? (
          <h3 className="section-label">Bulk Apply Current Settings</h3>
        ) : (
          <h4 className="subsection-label">Bulk Apply</h4>
        )}
        <div className="section-header-tools">
          <button
            type="button"
            className="btn-icon-subtle"
            onClick={(e) => {
              e.stopPropagation();
              setIsOpen(!isOpen);
            }}
            aria-expanded={isOpen}
            title={isOpen ? 'Collapse bulk apply' : 'Expand bulk apply'}
          >
            <ChevronDown
              size={14}
              style={{
                transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                transition: 'transform 0.18s ease',
              }}
            />
          </button>
        </div>
      </div>

      <motion.div
        ref={bodyRef}
        initial={false}
        animate={{
          opacity: isOpen ? 1 : 0,
          height: isOpen ? contentHeight : 0,
          y: isOpen ? 0 : -6,
        }}
        transition={{
          height: REVEAL_SECTION_TRANSITION,
          opacity: { duration: 0.14, ease: 'easeOut' },
          y: { duration: 0.18, ease: 'easeOut' },
        }}
        style={{
          overflow: 'hidden',
          pointerEvents: isOpen ? 'auto' : 'none',
          willChange: 'height, opacity, transform',
        }}
        onAnimationStart={() => {
          if (!isOpen) {
            stopAutoScrollRef.current?.();
            stopAutoScrollRef.current = null;
            return;
          }
          stopAutoScrollRef.current?.();
          stopAutoScrollRef.current = startPinToBottomLoop();
        }}
        onAnimationComplete={() => {
          stopAutoScrollRef.current?.();
          stopAutoScrollRef.current = null;
        }}
      >
        <div ref={bodyInnerRef} aria-hidden={!isOpen}>
            <div
              className="bulk-apply-options-list"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                marginBottom: '16px',
              }}
            >
                <div
                  className="metadata-toggle-row bulk-caption-switch-row clickable-row"
                  title="Apply Rotation and Flip"
                  onClick={() => setIncludeTransforms(!includeTransforms)}
                  style={{ cursor: 'pointer' }}
                >
                  <span className="metadata-toggle-label">Include Transforms</span>
                  <label className="metadata-checkbox-row" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="metadata-checkbox-input"
                      checked={includeTransforms}
                      onChange={(event) => setIncludeTransforms(event.target.checked)}
                      aria-label="Include transforms in bulk apply"
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

                <div
                  className="metadata-toggle-row bulk-caption-switch-row clickable-row"
                  title="Apply Aspect Ratio, Coordinates, and Viewport"
                  onClick={() => setIncludeCropState(!includeCropState)}
                  style={{ cursor: 'pointer' }}
                >
                  <span className="metadata-toggle-label">Include Crop State</span>
                  <label className="metadata-checkbox-row" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="metadata-checkbox-input"
                      checked={includeCropState}
                      onChange={(event) => setIncludeCropState(event.target.checked)}
                      aria-label="Include crop state in bulk apply"
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

                <div
                  className="metadata-toggle-row bulk-caption-switch-row clickable-row"
                  title="Apply Padding, Corner Radius, and Export Limits"
                  onClick={() => setIncludeUiTweaks(!includeUiTweaks)}
                  style={{ cursor: 'pointer' }}
                >
                  <span className="metadata-toggle-label">Include UI Tweaks</span>
                  <label className="metadata-checkbox-row" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="metadata-checkbox-input"
                      checked={includeUiTweaks}
                      onChange={(event) => setIncludeUiTweaks(event.target.checked)}
                      aria-label="Include UI tweaks in bulk apply"
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

                <div
                  className="metadata-toggle-row bulk-caption-switch-row clickable-row"
                  title="Apply AI Detection Region (ROI) to the selected images"
                  onClick={() => setIncludeDetectionRegion(!includeDetectionRegion)}
                  style={{ cursor: 'pointer' }}
                >
                  <span className="metadata-toggle-label">Include AI Detection Region</span>
                  <label className="metadata-checkbox-row" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="metadata-checkbox-input"
                      checked={includeDetectionRegion}
                      onChange={(event) => setIncludeDetectionRegion(event.target.checked)}
                      aria-label="Include detection region in bulk apply"
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

                {canIncludeWatermarkRemoval && (
                  <div
                    className="metadata-toggle-row bulk-caption-switch-row clickable-row"
                    title="Apply watermark removal to the selected images (runs the AI per image)"
                    onClick={() => setIncludeWatermarkRemoval(!includeWatermarkRemoval)}
                    style={{ cursor: 'pointer' }}
                  >
                    <span className="metadata-toggle-label">
                      Include Watermark Removal
                    </span>
                    <label className="metadata-checkbox-row" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="metadata-checkbox-input"
                        checked={includeWatermarkRemoval}
                        onChange={(event) =>
                          setIncludeWatermarkRemoval(event.target.checked)
                        }
                        aria-label="Include watermark removal in bulk apply"
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
                )}

                {canIncludeBackgroundRemoval && (
                  <div
                    className="metadata-toggle-row bulk-caption-switch-row clickable-row"
                    title="Apply background removal to the selected images (runs rembg per image)"
                    onClick={() => setIncludeBackgroundRemoval(!includeBackgroundRemoval)}
                    style={{ cursor: 'pointer' }}
                  >
                    <span className="metadata-toggle-label">
                      Include Background Removal
                    </span>
                    <label className="metadata-checkbox-row" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        className="metadata-checkbox-input"
                        checked={includeBackgroundRemoval}
                        onChange={(event) =>
                          setIncludeBackgroundRemoval(event.target.checked)
                        }
                        aria-label="Include background removal in bulk apply"
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
                )}

                <div
                  className="metadata-toggle-row bulk-caption-switch-row clickable-row"
                  title="Apply Caption Override"
                  onClick={() => setIncludeCaption(!includeCaption)}
                  style={{ cursor: 'pointer', marginBottom: includeCaption ? '0' : '4px' }}
                >
                  <span className="metadata-toggle-label">Include Caption</span>
                  <label className="metadata-checkbox-row" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      className="metadata-checkbox-input"
                      checked={includeCaption}
                      onChange={(event) => setIncludeCaption(event.target.checked)}
                      aria-label="Include caption override in bulk apply"
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

                {includeCaption && (
                  <div
                    className="caption-mode-selector-wrapper"
                    style={{ marginBottom: '12px', marginTop: '-4px', padding: '0 4px' }}
                  >
                    <SegmentedControl<'copy' | 'ai'>
                      value={captionMode}
                      onChange={setCaptionMode}
                      ariaLabel="Caption mode"
                      equalWidth
                      options={[
                        {
                          value: 'copy',
                          label: (
                            <>
                              <Copy size={12} />
                              <span>Copy Current</span>
                            </>
                          ),
                          title: 'Copy the caption from the current image to all selected images',
                        },
                        {
                          value: 'ai',
                          label: (
                            <>
                              <Sparkles size={12} />
                              <span>AI Generate</span>
                            </>
                          ),
                          title: 'Generate new AI captions for all selected images',
                        },
                      ]}
                    />
                  </div>
                )}
              </div>

            <div className="apply-grid">
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => apply('prev')}
              >
                <ArrowLeftCircle size={14} />
                <span>Previous</span>
              </button>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => apply('rest')}
              >
                <span>Rest</span>
                <ArrowRightCircle size={14} />
              </button>
              <button
                className="btn btn-primary btn-sm btn-glow"
                onClick={() => apply('all')}
              >
                <Zap size={14} />
                <span>All Images</span>
              </button>
            </div>
        </div>
      </motion.div>
    </section>
  );
};

export default React.memo(BulkApplySection);
