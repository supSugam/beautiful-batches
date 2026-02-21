import React, { useMemo, useState, useEffect, useRef } from 'react';
import { computeRowsLayout } from 'react-photo-album';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
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

const getRotatedBounds = (
  width: number,
  height: number,
  rotation: number,
): { width: number; height: number } => {
  const safeWidth = Math.max(1, Number(width) || 1);
  const safeHeight = Math.max(1, Number(height) || 1);
  const radians = ((Number(rotation) || 0) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  return {
    width: safeWidth * cos + safeHeight * sin,
    height: safeWidth * sin + safeHeight * cos,
  };
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
  const virtuosoRef = useRef<VirtuosoHandle | null>(null);
  const scrollerElementRef = useRef<HTMLElement | null>(null);
  const lastEndReachedAtRef = useRef(0);
  const lastAutoScrollRef = useRef<{ id: string; index: number } | null>(null);
  const lastAutoScrollAtRef = useRef(0);
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
      let contentWidth = Math.max(1, Number(img.naturalWidth) || 1);
      let contentHeight = Math.max(1, Number(img.naturalHeight) || 1);

      const coordinates = normalizeStoredCoordinates(cropEntry?.coordinates);
      if (coordinates) {
        contentWidth = Math.max(1, Number(coordinates.width) || 1);
        contentHeight = Math.max(1, Number(coordinates.height) || 1);
      } else {
        const rotatedBounds = getRotatedBounds(
          img.naturalWidth,
          img.naturalHeight,
          Number(cropEntry?.transforms?.rotate || 0),
        );
        contentWidth = Math.max(1, rotatedBounds.width);
        contentHeight = Math.max(1, rotatedBounds.height);
      }
      const ratio = contentWidth / contentHeight;
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

  const trackIndexByImageId = useMemo(() => {
    const next = new Map<string, number>();
    if (!layout?.tracks) return next;
    layout.tracks.forEach((track, trackIndex) => {
      track.photos.forEach((photo) => {
        next.set(photo.photo.id, trackIndex);
      });
    });
    return next;
  }, [layout]);

  useEffect(() => {
    if (!selectedId) {
      lastAutoScrollRef.current = null;
      return;
    }
    const targetIndex = trackIndexByImageId.get(selectedId);
    if (targetIndex === undefined) return;

    const previous = lastAutoScrollRef.current;
    if (previous && previous.index === targetIndex) {
      return;
    }

    const now = Date.now();
    const behavior: ScrollBehavior =
      now - lastAutoScrollAtRef.current < 140 ? 'auto' : 'smooth';
    lastAutoScrollAtRef.current = now;
    lastAutoScrollRef.current = { id: selectedId, index: targetIndex };
    virtuosoRef.current?.scrollToIndex({
      index: targetIndex,
      align: 'center',
      behavior,
    });
  }, [selectedId, trackIndexByImageId]);

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
          ref={virtuosoRef}
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
                    disableLayoutAnimation={false}
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
