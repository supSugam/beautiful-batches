import { useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import useStore from '../store/useStore';
import { toStoredCoordinates } from '../utils/cropCoordinates';
import type {
  CropEntry,
  ExportFormat,
  GalleryImage,
  IfFileExistsMode,
} from '../types/app';

const isTauriRuntime = () =>
  typeof window !== 'undefined' && Boolean(window.__TAURI_INTERNALS__);

const base64ToUint8Array = (base64Value: string): Uint8Array => {
  const binary = atob(base64Value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

const bytesToArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
};

const downloadZip = (blob: Blob, filename: string): void => {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
};

type TauriInputFile = {
  filePath: string;
  filename: string;
};

type TauriCropConfig = {
  originalName: string;
  coordinates: ReturnType<typeof toStoredCoordinates>;
  transforms: NonNullable<CropEntry['transforms']>;
  outputWidth: number | null;
};

type CreatePayloadParams = {
  images: GalleryImage[];
  cropData: Map<string, CropEntry>;
  format: ExportFormat;
  quality: number;
  ifFileExists: IfFileExistsMode;
};

type ProcessBulkExportArgs = {
  files: TauriInputFile[];
  config: {
    format: ExportFormat;
    quality: number;
    ifFileExists: IfFileExistsMode;
    crops: Record<string, TauriCropConfig>;
  };
};

const createExportPayload = (params: CreatePayloadParams): ProcessBulkExportArgs => {
  const { images, cropData, format, quality, ifFileExists } = params;
  const files: TauriInputFile[] = [];
  const crops: Record<string, TauriCropConfig> = {};

  for (const img of images) {
    if (!img.absolutePath) {
      console.warn(`Image "${img.name}" has no absolutePath, skipping export.`);
      continue;
    }

    const cropEntry = cropData.get(img.id);
    const uniqueName = `${img.id}_${img.name}`;

    files.push({
      filePath: img.absolutePath,
      filename: uniqueName,
    });

    crops[uniqueName] = {
      originalName: img.name,
      coordinates: toStoredCoordinates(cropEntry?.coordinates),
      transforms: cropEntry?.transforms || {
        rotate: 0,
        flip: { horizontal: false, vertical: false },
      },
      outputWidth: cropEntry?.outputWidth || null,
    };
  }

  return {
    files,
    config: {
      format,
      quality,
      ifFileExists,
      crops,
    },
  };
};

/**
 * Payload returned by the Tauri Rust command.
 */
type TauriExportResult = {
  zipBase64: string;
  fileName: string;
  processedCount: number;
  skippedCount: number;
};

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
      if (!isTauriRuntime()) {
        throw new Error(
          'Export requires the Tauri desktop runtime. Launch with `npm run tauri:dev`.',
        );
      }

      const payload = createExportPayload({
        images,
        cropData,
        format,
        quality,
        ifFileExists,
      });

      const result = await invoke<TauriExportResult>(
        'process_bulk_export',
        payload,
      );
      const zipBytes = base64ToUint8Array(result.zipBase64);
      const zipBuffer = bytesToArrayBuffer(zipBytes);
      const zipBlob = new Blob([zipBuffer], { type: 'application/zip' });
      downloadZip(zipBlob, result.fileName || `cropped_images_${Date.now()}.zip`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('Export error:', err);
      alert(`Failed to export images: ${message}`);
    } finally {
      setProcessing(null);
    }
  }, [images, cropData, format, quality, ifFileExists, setProcessing]);

  return { handleExport, processing };
};
