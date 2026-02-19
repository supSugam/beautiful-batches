import React, { useDeferredValue, useMemo } from 'react';
import { RowsPhotoAlbum } from 'react-photo-album';
import 'react-photo-album/rows.css';
import { ImageCard } from './ImageCard';
import useStore from '../store/useStore';
import { normalizeStoredCoordinates } from '../utils/cropCoordinates';
import './JustifiedGrid.css';

const getRotatedRatio = (width, height, rotation) => {
  const safeWidth = Math.max(1, Number(width) || 1);
  const safeHeight = Math.max(1, Number(height) || 1);
  const radians = ((Number(rotation) || 0) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));
  const rotatedWidth = safeWidth * cos + safeHeight * sin;
  const rotatedHeight = safeWidth * sin + safeHeight * cos;
  return rotatedWidth / Math.max(1, rotatedHeight);
};

const JustifiedGrid = ({
  images,
  targetRowHeight,
  padding = 8,
  selectedId,
  onSelect,
  onDelete,
}) => {
  const cropLayoutVersion = useStore((state) => state.cropLayoutVersion);
  const deferredLayoutVersion = useDeferredValue(cropLayoutVersion);
  const deferredRowHeight = useDeferredValue(targetRowHeight);

  // Photos for the grid components.
  // Recalculate row layout only when a crop change affects visual card ratio.
  const photos = useMemo(() => {
    if (!images || images.length === 0) return [];
    const cropData = useStore.getState().cropData;

    return images.map((img) => {
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
  }, [images, deferredLayoutVersion]);

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
        targetRowHeight={deferredRowHeight}
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
