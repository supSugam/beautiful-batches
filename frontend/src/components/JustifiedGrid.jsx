import React, { useMemo } from 'react';
import { RowsPhotoAlbum } from 'react-photo-album';
import 'react-photo-album/rows.css';
import { ImageCard } from './ImageCard';

const JustifiedGrid = ({
  images,
  targetRowHeight,
  padding = 8,
  cropData,
  showAllFooters,
  selectedId,
  onSelect,
  onCropChange,
  onDelete,
}) => {
  const photos = useMemo(() => {
    if (!images || images.length === 0) return [];

    return images.map((img) => {
      let ratio = img.naturalRatio || 1;

      // Check for rotation in cropData to adjust layout aspect ratio
      const cropEntry = cropData?.get(img.id);
      if (cropEntry?.transforms?.rotate) {
        const rotation = Math.abs(cropEntry.transforms.rotate);
        if (rotation % 180 === 90) {
          ratio = 1 / ratio;
        }
      }

      return {
        src: img.objectUrl,
        // We use a base size and aspect ratio
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
                cropState={cropData.get(photo.id)}
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
