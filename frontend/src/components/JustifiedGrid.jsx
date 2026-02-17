import React, { useDeferredValue, useMemo } from 'react';
import { RowsPhotoAlbum } from 'react-photo-album';
import 'react-photo-album/rows.css';
import { ImageCard } from './ImageCard';
import useStore from '../store/useStore';
import './JustifiedGrid.css';

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
      if (cropEntry?.coordinates) {
        ratio = cropEntry.coordinates.width / cropEntry.coordinates.height;
      }
      // 2. Otherwise, fall back to rotation-based swap logic if coordinates aren't set yet
      else if (cropEntry?.transforms?.rotate) {
        const rotation = Math.abs(cropEntry.transforms.rotate);
        if (rotation % 180 === 90) {
          ratio = 1 / ratio;
        }
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
