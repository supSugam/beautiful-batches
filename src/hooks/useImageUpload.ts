import { useCallback, type ChangeEvent } from 'react';
import useStore from '../store/useStore';
import {
  imagesFromFileList,
  pickImagesFromDirectory,
  loadImagesFromSavedDirectory,
  type LoadSavedDirectoryResult,
  type PickImagesFromDirectoryResult,
} from '../utils/directoryPicker';
import type { DirectoryHandle, RawUploadImage } from '../types/app';

export type ImageUploadResult = {
  handled: boolean;
  images: RawUploadImage[];
  directoryName: string;
  directoryHandle: DirectoryHandle | null;
  rootPaths: string[];
  rootNames: string[];
  rootPath: string;
};

export type RestoreDirectoryResult = {
  restored: boolean;
  images: RawUploadImage[];
  directoryName: string;
  directoryHandle: DirectoryHandle | null;
  rootPaths: string[];
  rootNames: string[];
  rootPath: string;
};

const toImageUploadResult = (
  result: PickImagesFromDirectoryResult | LoadSavedDirectoryResult,
  handled: boolean,
): ImageUploadResult => ({
  handled,
  images: Array.isArray(result.images) ? result.images : [],
  directoryName: 'directoryName' in result ? result.directoryName || '' : '',
  directoryHandle:
    'directoryHandle' in result ? result.directoryHandle || null : null,
  rootPath: 'rootPath' in result ? result.rootPath || '' : '',
  rootNames:
    'rootNames' in result && Array.isArray(result.rootNames)
      ? result.rootNames
      : [],
  rootPaths:
    'rootPaths' in result && Array.isArray(result.rootPaths)
      ? result.rootPaths
      : [],
});

export const useImageUpload = () => {
  const addImages = useStore((state) => state.addImages);

  const handleImagesLoaded = useCallback(
    (rawImages: RawUploadImage[]) => addImages(rawImages),
    [addImages],
  );

  const handleAddMoreViaDirectoryPicker =
    useCallback(async (): Promise<boolean> => {
      try {
        const saved = await loadImagesFromSavedDirectory({
          promptForPermission: true,
        });
        if (saved.supported && saved.available && saved.granted) {
          if (saved.images.length > 0 || saved.rootNames?.length) {
            await addImages(
              saved.images,
              saved.rootNames?.length ? saved.rootNames : [],
            );
          }
          return true;
        }

        const result = await pickImagesFromDirectory();
        if (!result.supported) return false;

        if (
          !result.aborted &&
          (result.images.length > 0 || result.directoryName)
        ) {
          await addImages(
            result.images,
            result.rootPath && result.directoryName
              ? [result.directoryName]
              : result.rootNames?.length
                ? result.rootNames
                : [],
          );
        }
        return true;
      } catch (error) {
        console.error('Directory picker add-more error:', error);
        return false;
      }
    }, [addImages]);

  const handlePickFolderViaDirectoryPicker = useCallback(
    async (): Promise<ImageUploadResult> => {
      try {
        const result = await pickImagesFromDirectory();
        if (!result.supported) {
          return {
            handled: false,
            images: [],
            directoryName: '',
            directoryHandle: null,
            rootPath: '',
            rootNames: [],
            rootPaths: [],
          };
        }
        if (result.aborted) {
          return {
            handled: true,
            images: [],
            directoryName: '',
            directoryHandle: null,
            rootPath: '',
            rootNames: [],
            rootPaths: [],
          };
        }

        return toImageUploadResult(result, true);
      } catch (error) {
        console.error('Directory picker add-folder error:', error);
        return {
          handled: false,
          images: [],
          directoryName: '',
          directoryHandle: null,
          rootPath: '',
          rootNames: [],
          rootPaths: [],
        };
      }
    },
    [],
  );

  const handleUpdateFolderAccess = useCallback(
    async (): Promise<ImageUploadResult> => {
      try {
        const saved = await loadImagesFromSavedDirectory({
          promptForPermission: true,
        });
        if (saved.supported && saved.available && saved.granted) {
          return toImageUploadResult(saved, true);
        }

        const result = await pickImagesFromDirectory();
        if (!result.supported) {
          return {
            handled: false,
            images: [],
            directoryName: '',
            directoryHandle: null,
            rootPath: '',
            rootNames: [],
            rootPaths: [],
          };
        }
        if (result.aborted) {
          return {
            handled: true,
            images: [],
            directoryName: '',
            directoryHandle: null,
            rootPath: '',
            rootNames: [],
            rootPaths: [],
          };
        }
        return toImageUploadResult(result, true);
      } catch (error) {
        console.error('Directory picker update-access error:', error);
        return {
          handled: false,
          images: [],
          directoryName: '',
          directoryHandle: null,
          rootPath: '',
          rootNames: [],
          rootPaths: [],
        };
      }
    },
    [],
  );

  const restoreLastDirectoryIfAvailable = useCallback(
    async (): Promise<RestoreDirectoryResult> => {
      try {
        const saved = await loadImagesFromSavedDirectory({
          promptForPermission: false,
        });
        if (!saved.supported || !saved.available || !saved.granted) {
          return {
            restored: false,
            images: [],
            directoryName: '',
            directoryHandle: null,
            rootPath: '',
            rootNames: [],
            rootPaths: [],
          };
        }
        if (saved.images.length > 0 || saved.rootNames?.length) {
          await addImages(
            saved.images,
            saved.rootNames?.length ? saved.rootNames : [],
          );
          return {
            restored: true,
            images: saved.images,
            directoryName: saved.directoryName || '',
            directoryHandle: saved.directoryHandle || null,
            rootPath: saved.rootPath || '',
            rootNames: saved.rootNames || [],
            rootPaths: saved.rootPaths || [],
          };
        }
        return {
          restored: false,
          images: [],
          directoryName: saved.directoryName || '',
          directoryHandle: saved.directoryHandle || null,
          rootPath: saved.rootPath || '',
          rootNames: saved.rootNames || [],
          rootPaths: saved.rootPaths || [],
        };
      } catch {
        return {
          restored: false,
          images: [],
          directoryName: '',
          directoryHandle: null,
          rootPath: '',
          rootNames: [],
          rootPaths: [],
        };
      }
    },
    [addImages],
  );

  const handleAddMore = useCallback(
    async (e: ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      const images = imagesFromFileList(files, 'add-more');
      if (images.length > 0) await addImages(images);
      e.target.value = '';
    },
    [addImages],
  );

  return {
    handleImagesLoaded,
    handleAddMore,
    handleAddMoreViaDirectoryPicker,
    handlePickFolderViaDirectoryPicker,
    handleUpdateFolderAccess,
    restoreLastDirectoryIfAvailable,
  };
};
