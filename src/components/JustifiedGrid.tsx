import React, { useMemo, useState, useEffect, useRef } from 'react';
import { computeRowsLayout } from 'react-photo-album';
import { Virtuoso } from 'react-virtuoso';
import { ImageCard } from './ImageCard';
import useStore from '../store/useStore';
import { normalizeStoredCoordinates } from '../utils/cropCoordinates';
import type { GalleryImage } from '../types/app';
import './JustifiedGrid.css';

const THUMB_SIZE_BUCKETS = [192, 256, 320, 384, 512, 640];

const resolveThumbnailSize = (targetRowHeight: number): number => {
  const dpr =
    typeof window === 'undefined'
      ? 1
      : Math.max(1, Number(window.devicePixelRatio || 1));
  const requested = Math.max(
    THUMB_SIZE_BUCKETS[0],
    Math.round(Math.max(1, Number(targetRowHeight || 1)) * dpr * 1.2),
  );
  return (
    THUMB_SIZE_BUCKETS.find((bucket) => bucket >= requested) ||
    THUMB_SIZE_BUCKETS[THUMB_SIZE_BUCKETS.length - 1]
  );
};

const getRotatedRatio = (
  width: number,
  height: number,
  rotation: number,
): number => {
  const safeWidth = Math.max(1, Number(width) || 1);
  const safeHeight = Math.max(1, Number(height) || 1);
  const radians = ((Number(rotation) || 0) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const rotatedWidth = safeWidth * cos + safeHeight * sin;
  const rotatedHeight = safeWidth * sin + safeHeight * cos;
  return rotatedWidth / Math.max(1, rotatedHeight);
};

type JustifiedGridProps = {
  images: GalleryImage[];
  targetRowHeight: number;
  padding?: number;
  showAllFooters?: boolean;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onDelete: (id: string) => void;
  onEndReached?: () => void;
};

type GridPhoto = {
  src: string;
  width: number;
  height: number;
  id: string;
  originalImage: GalleryImage;
};

const JustifiedGrid = ({
  images,
  targetRowHeight,
  padding = 8,
  selectedId,
  onSelect,
  onDelete,
  onEndReached,
}: JustifiedGridProps) => {
  const cropLayoutVersion = useStore((state) => state.cropLayoutVersion);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollerElementRef = useRef<HTMLElement | null>(null);
  const lastEndReachedAtRef = useRef(0);
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const thumbnailSize = useMemo(
    () => resolveThumbnailSize(targetRowHeight),
    [targetRowHeight],
  );

  useEffect(() => {
    if (!containerRef.current) return;
    const readViewportWidth = (fallbackWidth: number) => {
      const scrollerWidth = scrollerElementRef.current?.clientWidth || 0;
      if (scrollerWidth > 0) return Math.floor(scrollerWidth);
      return Math.floor(fallbackWidth);
    };

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(readViewportWidth(entry.contentRect.width));
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const photos = useMemo(() => {
    if (!images || images.length === 0) return [];
    const cropData = useStore.getState().cropData;

    return images.map((img): GridPhoto => {
      const cropEntry = cropData.get(img.id);
      let ratio = img.naturalRatio || 1;

      const coordinates = normalizeStoredCoordinates(cropEntry?.coordinates);
      if (coordinates) {
        ratio = coordinates.width / coordinates.height;
      } else if (cropEntry?.transforms?.rotate) {
        ratio = getRotatedRatio(
          img.naturalWidth,
          img.naturalHeight,
          cropEntry.transforms.rotate,
        );
      }
      const stableRatio =
        Number.isFinite(ratio) && ratio > 0 ? Math.round(ratio * 200) / 200 : 1;

      return {
        src: img.objectUrl,
        width: stableRatio * 1000,
        height: 1000,
        id: img.id,
        originalImage: img,
      };
    });
  }, [images, cropLayoutVersion]);

  const layout = useMemo(() => {
    if (!photos.length || containerWidth <= 0) return null;
    const computedLayout = computeRowsLayout(
      photos,
      padding,
      0,
      containerWidth,
      targetRowHeight,
    );

    if (computedLayout?.tracks) {
      computedLayout.tracks.forEach((track) => {
        const rowHeight = track.photos[0]?.height || 0;
        // If a row (usually the last row or a single image) was stretched significantly
        // to fill the container, constrain its height. This prevents "blowout" where
        // a single image stretches to fill a massive screen width.
        if (rowHeight > targetRowHeight * 1.5) {
          const capHeight = targetRowHeight * 1.25; // allow slight stretch
          const scale = capHeight / rowHeight;
          track.photos.forEach((p) => {
            p.width = p.width * scale;
            p.height = capHeight;
          });
        }
      });
    }

    return computedLayout;
  }, [photos, padding, containerWidth, targetRowHeight]);

  if (!images.length) return null;

  const handleEndReached = () => {
    if (!onEndReached) return;
    const now = Date.now();
    if (now - lastEndReachedAtRef.current < 250) return;
    lastEndReachedAtRef.current = now;
    onEndReached();
  };

  return (
    <div
      ref={containerRef}
      className="justified-grid-container"
      style={{ width: '100%', height: '100%' }}
    >
      {layout && (
        <Virtuoso
          style={{ height: '100%', overflowX: 'hidden' }}
          data={layout.tracks}
          overscan={120}
          endReached={handleEndReached}
          scrollerRef={(ref) => {
            const element = ref instanceof HTMLElement ? ref : null;
            scrollerElementRef.current = element;
            if (element) {
              setContainerWidth(Math.floor(element.clientWidth));
            }
          }}
          itemContent={(index, track) => (
            <div
              key={index}
              style={{
                display: 'flex',
                gap: padding,
                marginBottom: padding,
                direction: 'ltr',
              }}
            >
              {track.photos.map((photo) => (
                <div
                  key={photo.photo.id}
                  style={{
                    width: photo.width,
                    height: photo.height,
                    position: 'relative',
                  }}
                >
                  <ImageCard
                    image={photo.photo.originalImage}
                    rowHeight={photo.height}
                    thumbnailSize={thumbnailSize}
                    selected={selectedId === photo.photo.id}
                    onSelect={onSelect}
                    onDelete={onDelete}
                    disableLayoutAnimation={true}
                  />
                </div>
              ))}
            </div>
          )}
        />
      )}
    </div>
  );
};

export { JustifiedGrid };
