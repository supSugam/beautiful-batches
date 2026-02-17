import { useCallback } from 'react';
import useStore from '../store/useStore';

export const useExportLogic = () => {
  const {
    images,
    cropData,
    format,
    quality,
    ifFileExists,
    processing,
    setProcessing,
  } = useStore();

  const handleExport = useCallback(async () => {
    if (images.length === 0) return;

    setProcessing({ current: 0, total: images.length });

    try {
      const formData = new FormData();
      const cropsMap = {};

      for (const img of images) {
        const cropEntry = cropData.get(img.id);
        const uniqueName = `${img.id}_${img.name}`;
        formData.append('files', img.file, uniqueName);

        cropsMap[uniqueName] = {
          originalName: img.name,
          coordinates: cropEntry?.coordinates || null,
          transforms: cropEntry?.transforms || {
            rotate: 0,
            flip: { horizontal: false, vertical: false },
          },
          outputWidth: cropEntry?.outputWidth || null,
        };
      }

      formData.append(
        'config',
        JSON.stringify({
          format,
          quality,
          ifFileExists,
          crops: cropsMap,
        }),
      );

      const response = await fetch('http://localhost:8000/api/process-bulk', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.detail || 'Export failed');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `cropped_images_${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export error:', err);
      alert('Failed to export images: ' + err.message);
    } finally {
      setProcessing(null);
    }
  }, [images, cropData, format, quality, ifFileExists, setProcessing]);

  return { handleExport, processing };
};
