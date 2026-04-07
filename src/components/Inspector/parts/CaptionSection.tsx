import React, { useEffect, useRef, useState } from 'react';
import { Settings, Sparkles } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import useStore from '../../../store/useStore';

type CaptionSectionProps = {
  imageId: string;
  imageName: string;
  imageAbsolutePath?: string;
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
  imageAbsolutePath,
}: CaptionSectionProps) => {
  const hasCaptionOverride = useStore((state) => state.captionById.has(imageId));
  const captionOverride = useStore(
    (state) => state.captionById.get(imageId) ?? '',
  );
  const setCaptionForImage = useStore((state) => state.setCaptionForImage);
  const updateProviderSettings = useStore((state) => state.updateProviderSettings);
  const addToast = useStore((state) => state.addToast);

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

  const captioningSettings = useStore((state) => state.captioningSettings);
  const openSettings = useStore((state) => state.openSettings);

  const handleMagicCaption = async () => {
    if (isProcessing || !imageAbsolutePath) return;

    const providerSettings = captioningSettings[captioningSettings.provider];
    if (captioningSettings.provider !== 'custom' && !providerSettings.apiKey) {
      addToast(`Please configure API key for ${captioningSettings.provider}`, 'warning');
      openSettings('captioning');
      return;
    }
    
    if (captioningSettings.provider === 'custom' && !captioningSettings.custom.endpoint) {
      addToast(`Please configure Custom Endpoint URL`, 'warning');
      openSettings('captioning');
      return;
    }

    setIsProcessing(true);
    try {
      const result = await invoke<{ caption: string; raw_response?: string }>('generate_ai_caption', {
        imagePath: imageAbsolutePath,
        provider: captioningSettings.provider,
        model: 'model' in providerSettings ? providerSettings.model : '',
        apiKey: providerSettings.apiKey,
        systemPrompt: captioningSettings.systemPrompt,
        ...(captioningSettings.provider === 'custom' ? {
          endpoint: captioningSettings.custom.endpoint,
          customBodyTemplate: captioningSettings.custom.customBodyTemplate,
          customHeaders: captioningSettings.custom.customHeaders,
          responseField: captioningSettings.custom.responseField,
        } : {})
      });
      if (result?.caption) {
        setCaptionForImage(imageId, result.caption);
        if (captioningSettings.provider === 'custom' && result.raw_response) {
          updateProviderSettings('custom', { lastResponse: result.raw_response });
        }
        addToast('Caption generated successfully!', 'success');
      }
    } catch (error) {
      console.error('Failed to generate AI caption:', error);
      addToast(String(error) || 'Failed to generate AI caption', 'error');
    } finally {
      setIsProcessing(false);
    }
  };

  useEffect(() => {
    setIsProcessing(false);
    if (magicTimerRef.current) {
      window.clearTimeout(magicTimerRef.current);
      magicTimerRef.current = null;
    }
  }, [imageId]);

  const caption = captionOverride;
  const outcomeLabel = hasCaptionOverride && captionOverride.length > 0
    ? 'Your custom caption will be exported for this image.'
    : 'Caption text will be skipped for this image.';

  return (
    <section className="control-section caption-section">
      <div className="section-header">
        <h3 className="section-label">Caption</h3>
        <div className="section-header-tools">
          <button
            type="button"
            className="btn-icon-subtle"
            onClick={() => openSettings('captioning')}
            title="Caption settings"
          >
            <Settings size={12} />
          </button>
        </div>
      </div>
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
          onClick={handleMagicCaption}
          disabled={isProcessing}
          title={isProcessing ? 'Generating...' : 'Caption assist'}
          aria-label="Caption assist"
        >
          <SparkleGlyph active={isProcessing} />
        </button>
      </div>
      <div className="caption-meta-row">
        <p className="caption-outcome-note">{outcomeLabel}</p>
      </div>
    </section>
  );
};

export default React.memo(CaptionSection);
