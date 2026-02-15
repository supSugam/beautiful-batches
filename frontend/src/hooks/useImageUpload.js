import { useCallback } from 'react';
import useStore from '../store/useStore';

export const IMAGE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.bmp',
  '.gif',
  '.tiff',
  '.tif',
]);

export const useImageUpload = () => {
  const addImages = useStore(state => state.addImages);

  const handleImagesLoaded = useCallback(
    (rawImages) => {
      addImages(rawImages);
    },
    [addImages],
  );

  const handleAddMore = useCallback(
    async (e) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      const valid = Array.from(files).filter((f) =>
        IMAGE_EXTENSIONS.has('.' + f.name.split('.').pop().toLowerCase()),
      );
      addImages(
        valid.map((file) => ({
          file,
          id: `add-${Date.now()}-${file.name}`,
          relativePath: file.webkitRelativePath || file.name,
        })),
      );
      e.target.value = '';
    },
    [addImages],
  );

  return { handleImagesLoaded, handleAddMore };
};
