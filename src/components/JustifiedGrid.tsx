import React, { useMemo } from 'react';
import { RowsPhotoAlbum } from 'react-photo-album';
import 'react-photo-album/rows.css';
import { ImageCard } from './ImageCard';
import useStore from '../store/useStore';
import { normalizeStoredCoordinates } from '../utils/cropCoordinates';
import type { GalleryImage } from '../types/app';
import './JustifiedGrid.css';

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
  showAllFooters: _showAllFooters,
  selectedId,
  onSelect,
  onDelete,
}: JustifiedGridProps) => {
  const cropLayoutVersion = useStore((state) => state.cropLayoutVersion);

  // Photos for the grid components.
  // Recalculate row layout only when a crop change affects visual card ratio.
  // We explicitly intentionally DO NOT subscribe to `cropData` here because we 
  // only want to recalculate row layouts when a crop change affects the *visual card ratio*,
  // which is correctly signaled by `cropLayoutVersion`.
  // Panning/zooming inside an established crop box does not change the ratio.
  const photos = useMemo(() => {
    if (!images || images.length === 0) return [];
    
    // Read the current state of cropData without subscribing to every coordinate tick
    const cropData = useStore.getState().cropData;

    return images.map((img): GridPhoto => {
      const cropEntry = cropData.get(img.id);
      let ratio = img.naturalRatio || 1;

      // 1. If we have active crop coordinates, use them for the aspect ratio of the card
      const coordinates = normalizeStoredCoordinates(cropEntry?.coordinates);
      if (coordinates) {
        ratio = coordinates.width / coordinates.height;
      }
      // 2. Otherwise, fall back to rotation-based swap logic if coordinates aren't set yet
      else if (cropEntry?.transforms?.rotate) {
        ratio = getRotatedRatio(
          img.naturalWidth,
          img.naturalHeight,
          cropEntry.transforms.rotate,
        );
      }
      const stableRatio =
        Number.isFinite(ratio) && ratio > 0
          ? Math.round(ratio * 200) / 200
          : 1;

      return {
        src: img.objectUrl,
        width: stableRatio * 1000,
        height: 1000,
        id: img.id,
        originalImage: img,
      };
    });
  }, [images, cropLayoutVersion]);

  // Disable per-card layout animation to avoid large reflow spikes on selection/open.
  const disableLayoutAnimation = true;

  return (
    <div
      className="justified-grid-container"
      style={{ width: '100%' }}
      dir="ltr"
    >
      <RowsPhotoAlbum
        photos={photos}
        targetRowHeight={targetRowHeight}
        spacing={padding}
        padding={0} // Outer padding
        render={{
          photo: (props, { photo, width, height }) => (
            <div
              key={photo.id}
              style={{
                width,
                height,
                position: 'relative',
              }}
            >
              <ImageCard
                image={photo.originalImage}
                rowHeight={height}
                selected={selectedId === photo.id}
                onSelect={onSelect}
                onDelete={onDelete}
                disableLayoutAnimation={disableLayoutAnimation}
              />
            </div>
          ),
        }}
      />
    </div>
  );
};

export { JustifiedGrid };
