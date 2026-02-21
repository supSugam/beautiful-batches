import React, { useEffect, useMemo, useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import useStore from '../../../store/useStore';
import { loadSidecarCaptionForImagePath } from '../../../utils/directoryPicker';

type CaptionSectionProps = {
  imageId: string;
  imageName: string;
  imageAbsolutePath?: string;
};

type SidecarCaptionState = {
  loading: boolean;
  exists: boolean;
  content: string;
};

const SparkleGlyph = ({ active }: { active: boolean }) => (
  <svg
    className={`caption-sparkle-glyph ${active ? 'active' : ''}`}
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
  >
    <g className="caption-sparkle-core">
      <path
        className="caption-sparkle-part caption-sparkle-part-main"
        d="M12 2.25L13.95 8.05L19.75 10L13.95 11.95L12 17.75L10.05 11.95L4.25 10L10.05 8.05L12 2.25Z"
      />
      <path
        className="caption-sparkle-part caption-sparkle-part-a"
        d="M18.2 13.8L18.9 16L21.1 16.7L18.9 17.4L18.2 19.6L17.5 17.4L15.3 16.7L17.5 16L18.2 13.8Z"
      />
      <path
        className="caption-sparkle-part caption-sparkle-part-b"
        d="M6 4.5L6.6 6.2L8.3 6.8L6.6 7.4L6 9.1L5.4 7.4L3.7 6.8L5.4 6.2L6 4.5Z"
      />
    </g>
  </svg>
);

const CaptionSection = ({
  imageId,
  imageName,
  imageAbsolutePath,
}: CaptionSectionProps) => {
  const hasCaptionOverride = useStore((state) => state.captionById.has(imageId));
  const captionOverride = useStore(
    (state) => state.captionById.get(imageId) ?? '',
  );
  const setCaptionForImage = useStore((state) => state.setCaptionForImage);
  const resetCaptionForImage = useStore((state) => state.resetCaptionForImage);

  const [isProcessing, setIsProcessing] = useState(false);
  const [sidecarCaption, setSidecarCaption] = useState<SidecarCaptionState>({
    loading: false,
    exists: false,
    content: '',
  });
  const magicTimerRef = useRef<number | null>(null);
  const sidecarRequestIdRef = useRef(0);

  useEffect(
    () => () => {
      if (magicTimerRef.current) {
        window.clearTimeout(magicTimerRef.current);
        magicTimerRef.current = null;
      }
    },
    [],
  );

  const triggerMagicUi = () => {
    if (magicTimerRef.current) {
      window.clearTimeout(magicTimerRef.current);
    }
    setIsProcessing(true);
    magicTimerRef.current = window.setTimeout(() => {
      setIsProcessing(false);
      magicTimerRef.current = null;
    }, 3000);
  };

  useEffect(() => {
    setIsProcessing(false);
    if (magicTimerRef.current) {
      window.clearTimeout(magicTimerRef.current);
      magicTimerRef.current = null;
    }
  }, [imageId]);

  useEffect(() => {
    const path = String(imageAbsolutePath || '').trim();
    sidecarRequestIdRef.current += 1;
    const requestId = sidecarRequestIdRef.current;

    if (!path) {
      setSidecarCaption({
        loading: false,
        exists: false,
        content: '',
      });
      return;
    }

    setSidecarCaption({
      loading: true,
      exists: false,
      content: '',
    });

    loadSidecarCaptionForImagePath(path)
      .then((result) => {
        if (sidecarRequestIdRef.current !== requestId) return;
        const nextValue = {
          exists: Boolean(result?.exists),
          content: typeof result?.content === 'string' ? result.content : '',
        };
        setSidecarCaption({
          loading: false,
          exists: nextValue.exists,
          content: nextValue.content,
        });
      })
      .catch(() => {
        if (sidecarRequestIdRef.current !== requestId) return;
        setSidecarCaption({
          loading: false,
          exists: false,
          content: '',
        });
      });
  }, [imageAbsolutePath, imageId]);

  const sidecarFileName = useMemo(() => {
    const safeName = String(imageName || '').trim();
    if (!safeName) return 'caption.txt';
    const dotIndex = safeName.lastIndexOf('.');
    const baseName =
      dotIndex > 0 ? safeName.slice(0, dotIndex).trim() : safeName;
    return `${baseName || safeName}.txt`;
  }, [imageName]);

  const caption = hasCaptionOverride ? captionOverride : sidecarCaption.content;
  const hasSidecarCaption = sidecarCaption.exists;
  const canResetToSidecar = hasSidecarCaption && hasCaptionOverride;
  const hasEmptyOverride = hasCaptionOverride && captionOverride.length === 0;
  const outcomeLabel = useMemo(() => {
    if (hasCaptionOverride) {
      if (hasEmptyOverride) {
        return 'Caption text will be skipped for this image.';
      }
      return 'Your custom caption will be exported for this image.';
    }
    if (sidecarCaption.loading) {
      return `${sidecarFileName} will be used once it finishes loading.`;
    }
    if (hasSidecarCaption) {
      return `${sidecarFileName} will be used for export.`;
    }
    return 'Caption text will be skipped for this image.';
  }, [
    hasEmptyOverride,
    hasCaptionOverride,
    hasSidecarCaption,
    sidecarCaption.loading,
    sidecarFileName,
  ]);

  return (
    <section className="control-section caption-section">
      <h3 className="section-label">Caption</h3>
      <div className="caption-input-shell">
        <textarea
          className="caption-textarea"
          value={caption}
          onChange={(event) => setCaptionForImage(imageId, event.target.value)}
          placeholder="Type caption for this image..."
          spellCheck={false}
        />
        <button
          type="button"
          className={`caption-magic-btn ${isProcessing ? 'active' : ''}`}
          onClick={triggerMagicUi}
          title="Caption assist"
          aria-label="Caption assist"
        >
          <SparkleGlyph active={isProcessing} />
        </button>
        {canResetToSidecar && (
          <button
            type="button"
            className="caption-reset-inline-btn"
            onClick={() => resetCaptionForImage(imageId)}
            title={`Revert to ${sidecarFileName}`}
            aria-label={`Revert caption to ${sidecarFileName}`}
          >
            <RotateCcw size={14} />
          </button>
        )}
      </div>
      <div className="caption-meta-row">
        <p className="caption-outcome-note">{outcomeLabel}</p>
      </div>
    </section>
  );
};

export default React.memo(CaptionSection);
