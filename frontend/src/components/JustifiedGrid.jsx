import React, { useState, useEffect, useRef, useMemo } from 'react';
import { ImageCard } from './ImageCard';

const JustifiedGrid = ({
  images,
  targetRowHeight,
  padding = 8,
  cropData,
  showAllFooters,
  onCropChange,
  onDelete,
}) => {
  const containerRef = useRef(null);
  const [containerWidth, setContainerWidth] = useState(0);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (let entry of entries) {
        if (entry.contentRect.width > 0) {
          setContainerWidth(entry.contentRect.width);
        }
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  const rows = useMemo(() => {
    if (!containerWidth || !images || images.length === 0) return [];

    const result = [];
    let currentBuffer = [];
    let currentRatioSum = 0;

    images.forEach((img) => {
      let ratio = img.naturalRatio || 1;

      // Check for rotation in cropData
      const cropEntry = cropData?.get(img.id);
      if (cropEntry?.transforms?.rotate) {
        const rotation = Math.abs(cropEntry.transforms.rotate);
        if (rotation % 180 === 90) {
          // If rotated 90 or 270 degrees, invert the aspect ratio
          ratio = 1 / ratio;
        }
      }

      currentBuffer.push({ ...img, effectiveRatio: ratio });
      currentRatioSum += ratio;

      const gaps = (currentBuffer.length - 1) * padding;
      const height = (containerWidth - gaps) / currentRatioSum;

      if (height <= targetRowHeight) {
        result.push({
          images: currentBuffer,
          height: height,
        });
        currentBuffer = [];
        currentRatioSum = 0;
      }
    });

    if (currentBuffer.length > 0) {
      result.push({
        images: currentBuffer,
        height: targetRowHeight,
        isLast: true,
      });
    }

    return result;
  }, [images, containerWidth, targetRowHeight, padding, cropData]);

  return (
    <div ref={containerRef} style={{ width: '100%' }}>
      {rows.map((row, rIdx) => (
        <div
          key={rIdx}
          style={{
            display: 'flex',
            flexWrap: 'nowrap',
            gap: padding,
            marginBottom: padding,
            width: '100%',
          }}
        >
          {row.images.map((img) => {
            const width =
              row.height * (img.effectiveRatio || img.naturalRatio || 1);
            return (
              <div
                key={img.id}
                style={{
                  width: width,
                  flexGrow: row.isLast ? 0 : 1,
                  flexShrink: 1,
                }}
              >
                <ImageCard
                  image={img}
                  rowHeight={row.height}
                  cropState={cropData.get(img.id)}
                  showAllFooters={showAllFooters}
                  onCropChange={onCropChange}
                  onDelete={onDelete}
                />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
};

export { JustifiedGrid };
