import React, { useMemo, useState, useEffect, useRef } from 'react';
import { computeRowsLayout } from 'react-photo-album';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
import { ImageCard } from './ImageCard';
import useStore from '../store/useStore';
import { normalizeStoredCoordinates } from '../utils/cropCoordinates';
import type { GalleryImage } from '../types/app';
import './JustifiedGrid.css';

const resolveThumbnailSize = (targetRowHeight: number): number => {
  const dpr = typeof window === 'undefined' ? 1 : Math.max(1, window.devicePixelRatio || 1);
  return Math.round(targetRowHeight * dpr * 1.2);
};

type JustifiedGridProps = {
  images: GalleryImage[];
  excludedById: Map<string, boolean>;
  targetRowHeight: number;
  padding?: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onDelete: (id: string) => void;
  onRestore: (id: string) => void;
  onEndReached?: () => void;
  isSingleEditMode?: boolean;
};

const JustifiedGrid = ({
  images,
  excludedById,
  targetRowHeight,
  padding = 12,
  selectedId,
  onSelect,
  onDelete,
  onRestore,
  onEndReached,
  isSingleEditMode = false,
}: JustifiedGridProps) => {
  const cropLayoutVersion = useStore((state) => state.cropLayoutVersion);
  const containerRef = useRef<HTMLDivElement>(null);
  const virtuosoRef = useRef<VirtuosoHandle | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const thumbnailSize = useMemo(() => resolveThumbnailSize(targetRowHeight), [targetRowHeight]);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const photos = useMemo(() => {
    return images.map((img) => {
      const cropData = useStore.getState().cropData;
      const cropEntry = cropData.get(img.id);
      
      const coords = normalizeStoredCoordinates(cropEntry?.coordinates);
      const cw = coords ? Number(coords.width) : img.naturalWidth;
      const ch = coords ? Number(coords.height) : img.naturalHeight;
      const ratio = cw / ch;

      return {
        src: img.objectUrl,
        width: ratio * 1000,
        height: 1000,
        id: img.id,
        originalImage: img,
      };
    });
  }, [images, cropLayoutVersion]);

  const layout = useMemo(() => {
    if (!photos.length || containerWidth <= 0) return null;
    return computeRowsLayout(photos, padding, 0, containerWidth, targetRowHeight);
  }, [photos, padding, containerWidth, targetRowHeight]);

  useEffect(() => {
    if (!selectedId || !virtuosoRef.current || !layout) return;

    const trackIndex = layout.tracks.findIndex((track) =>
      track.photos.some((photo) => photo.photo.id === selectedId)
    );

    if (trackIndex >= 0) {
      virtuosoRef.current.scrollIntoView({
        index: trackIndex,
        align: 'center',
        behavior: 'smooth',
      });
    }
  }, [selectedId, layout]);

  if (!images.length || containerWidth <= 0) {
    return <div ref={containerRef} style={{ width: '100%', height: '100%' }} />;
  }

  return (
    <div
      ref={containerRef}
      className="justified-grid-container"
      style={{ width: '100%', height: '100%' }}
    >
      {isSingleEditMode && images.length === 1 ? (
        <div 
          className="single-edit-preview-wrap"
          style={{ 
            display: 'flex', 
            justifyContent: 'center', 
            alignItems: 'center', 
            height: '100%',
            padding: padding * 2 
          }}
        >
          <ImageCard
            image={images[0]}
            excluded={excludedById.has(images[0].id)}
            width={Math.min(containerWidth - padding * 4, (images[0].naturalRatio || 1) * (window.innerHeight * 0.6))}
            thumbnailSize={thumbnailSize * 2}
            selected={selectedId === images[0].id}
            onSelect={onSelect}
            onDelete={onDelete}
            onRestore={onRestore}
            isSingleEditMode={true}
          />
        </div>
      ) : layout && (
        <Virtuoso
          ref={virtuosoRef}
          style={{ height: '100%' }}
          data={layout.tracks}
          overscan={400}
          endReached={onEndReached}
          itemContent={(index, track) => (
            <div
              key={index}
              style={{
                display: 'flex',
                gap: padding,
                marginBottom: padding,
                paddingRight: padding, // match the gap on the right
              }}
            >
              {track.photos.map((photo) => (
                <ImageCard
                  key={photo.photo.id}
                  image={photo.photo.originalImage}
                  excluded={excludedById.has(photo.photo.id)}
                  width={photo.width}
                  thumbnailSize={thumbnailSize}
                  selected={selectedId === photo.photo.id}
                  onSelect={onSelect}
                  onDelete={onDelete}
                  onRestore={onRestore}
                  isSingleEditMode={isSingleEditMode}
                />
              ))}
            </div>
          )}
        />
      )}
    </div>
  );
};

export { JustifiedGrid };
