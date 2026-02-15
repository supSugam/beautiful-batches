import React, { useMemo } from 'react';
import { RowsPhotoAlbum } from 'react-photo-album';
import 'react-photo-album/rows.css';
import { ImageCard } from './ImageCard';
import useStore from '../store/useStore';

const JustifiedGrid = ({
  images,
  targetRowHeight,
  padding = 8,
  showAllFooters,
  selectedId,
  onSelect,
  onCropChange,
  onDelete,
}) => {
  const cropData = useStore((state) => state.cropData);

  // Photos for the grid components.
  // We now include cropData in the dependencies to allow REAL-TIME layout shifts
  const photos = useMemo(() => {
    if (!images || images.length === 0) return [];

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

      return {
        src: img.objectUrl,
        width: ratio * 1000,
        height: 1000,
        id: img.id,
        originalImage: img,
      };
    });
  }, [images, cropData]);

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
                showAllFooters={showAllFooters}
                selected={selectedId === photo.id}
                onSelect={() =>
                  onSelect(photo.id === selectedId ? null : photo.id)
                }
                onCropChange={onCropChange}
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
