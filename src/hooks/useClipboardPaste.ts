import { useCallback, useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { RawUploadImage } from '../types/app';

const ACCEPTED_IMAGE_MIME_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
  'image/bmp',
  'image/tiff',
  'image/svg+xml',
]);

type UseClipboardPasteOptions = {
  onPaste?: (images: RawUploadImage[]) => void | Promise<void>;
  onError?: (error: string) => void;
  enabled?: boolean;
};

/**
 * Convert a base64 string to a Uint8Array efficiently using fetch.
 * This avoids throwing V8 into a 'NeedDebuggerBreak trap' (OOM) on very large clipboard images.
 */
async function base64ToUint8Array(base64: string, mimeType: string = 'image/png'): Promise<Uint8Array> {
  const dataUrl = `data:${mimeType};base64,${base64}`;
  const response = await fetch(dataUrl);
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

const extForMime = (mime: string): string => {
  if (mime.includes('png')) return 'png';
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'gif';
  if (mime.includes('bmp')) return 'bmp';
  if (mime.includes('tiff')) return 'tiff';
  if (mime.includes('svg')) return 'svg';
  return 'png';
};

/**
 * Try to read an image from the Tauri clipboard backend.
 * Returns null if no image is available.
 */
const readTauriClipboardImage = async (): Promise<File | null> => {
  const result = await invoke<{ data: string; mime_type: string } | null>('read_clipboard_image', {});
  if (!result?.data) return null;
  const mimeType = result.mime_type || 'image/png';
  const bytes = await base64ToUint8Array(result.data, mimeType);
  return new File([bytes.buffer.slice(0) as ArrayBuffer], `clipboard-${Date.now()}.${extForMime(mimeType)}`, { type: mimeType });
};

/**
 * Build RawUploadImage entries from File objects for the gallery.
 */
const filesToRawImages = (files: File[]): RawUploadImage[] =>
  files.map((file, index) => ({
    file,
    id: `pasted-${Date.now()}-${index}-${Math.random().toString(36).substring(2, 9)}`,
    relativePath: file.name,
    absolutePath: '',
    assetUrl: '',
    nativeSize: file.size,
    nativeWidth: 0,
    nativeHeight: 0,
    nativeAccessedAt: 0,
    nativeCreatedAt: 0,
    nativeLastModifiedAt: file.lastModified || Date.now(),
  }));

export const useClipboardPaste = ({
  onPaste,
  onError,
  enabled = true,
}: UseClipboardPasteOptions = {}) => {
  const onPasteRef = useRef(onPaste);
  const onErrorRef = useRef(onError);
  const isHandlingRef = useRef(false);

  useEffect(() => {
    onPasteRef.current = onPaste;
    onErrorRef.current = onError;
  }, [onPaste, onError]);

  const processFiles = useCallback((files: File[]) => {
    if (files.length === 0 || isHandlingRef.current) return;
    isHandlingRef.current = true;
    const images = filesToRawImages(files);
    void Promise.resolve(onPasteRef.current?.(images)).finally(() => {
      isHandlingRef.current = false;
    });
  }, []);

  useEffect(() => {
    if (!enabled) return;

    const handlePaste = async (e: ClipboardEvent) => {
      try {
        if (isHandlingRef.current) return;

        // Ignore paste events in text inputs
        const target = e.target as HTMLElement | null;
        const tag = String(target?.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return;

        // 1. Try DOM clipboard items first (most direct — works in both browser and Tauri)
        const items = e.clipboardData?.items;
        if (items) {
          const files: File[] = [];
          for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (!item || !ACCEPTED_IMAGE_MIME_TYPES.has(item.type)) continue;
            const blob = item.getAsFile();
            if (!blob) continue;
            files.push(new File([blob], `clipboard-${Date.now()}.${extForMime(item.type)}`, { type: item.type }));
          }
          if (files.length > 0) {
            e.preventDefault();
            processFiles(files);
            return;
          }
        }

        // 2. Fallback: Tauri native clipboard (handles screenshots copied via system tools
        //    where clipboardData.items may be empty in the webview)
        const tauriFile = await readTauriClipboardImage();
        if (tauriFile) {
          e.preventDefault();
          processFiles([tauriFile]);
        }
      } catch (err) {
        console.error('Paste error:', err);
        onErrorRef.current?.(err instanceof Error ? err.message : String(err));
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [enabled, processFiles]);

  return {};
};
