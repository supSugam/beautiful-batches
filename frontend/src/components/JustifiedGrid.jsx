import React, { useDeferredValue, useMemo } from 'react';
import { RowsPhotoAlbum } from 'react-photo-album';
import 'react-photo-album/rows.css';
import { ImageCard } from './ImageCard';
import useStore from '../store/useStore';

const JustifiedGrid = ({
  images,
  targetRowHeight,
  padding = 8,
  selectedId,
  onSelect,
  onDelete,
}) => {
  const cropData = useStore((state) => state.cropData);
  const deferredCropData = useDeferredValue(cropData);

  // Photos for the grid components.
  // Defer layout recalculation under drag pressure to keep pointer interactions smooth.
  const photos = useMemo(() => {
    if (!images || images.length === 0) return [];

    return images.map((img) => {
      const cropEntry = deferredCropData.get(img.id);
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

      return {
        src: img.objectUrl,
        width: ratio * 1000,
        height: 1000,
        id: img.id,
        originalImage: img,
      };
    });
  }, [images, deferredCropData]);

  return (
    <div className="justified-grid-container" style={{ width: '100%' }}>
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
                onSelect={() =>
                  onSelect(photo.id === selectedId ? null : photo.id)
                }
                onDelete={onDelete}
              />
            </div>
          ),
        }}
      />
    </div>
  );
};

export { JustifiedGrid };
