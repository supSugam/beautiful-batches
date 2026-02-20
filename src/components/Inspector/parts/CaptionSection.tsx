import React, { useEffect, useRef, useState } from 'react';
import useStore from '../../../store/useStore';

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

const CaptionSection = ({ imageId }: { imageId: string }) => {
  const caption = useStore((state) => state.captionById.get(imageId) || '');
  const setCaptionForImage = useStore((state) => state.setCaptionForImage);
  const [isProcessing, setIsProcessing] = useState(false);
  const magicTimerRef = useRef<number | null>(null);

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

  return (
    <section className="control-section caption-section">
      <h3 className="section-label">Caption</h3>
      <div className="caption-input-shell">
        <textarea
          className="caption-textarea"
          value={caption}
          onChange={(event) => setCaptionForImage(imageId, event.target.value)}
          placeholder="Write caption text for this image..."
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
      </div>
    </section>
  );
};

export default React.memo(CaptionSection);
