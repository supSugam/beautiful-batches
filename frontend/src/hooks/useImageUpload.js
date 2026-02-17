import { useCallback } from 'react';
import useStore from '../store/useStore';
import {
  imagesFromFileList,
  loadImagesFromSavedDirectory,
  pickImagesFromDirectory,
} from '../utils/directoryPicker';

export const useImageUpload = () => {
  const addImages = useStore((state) => state.addImages);

  const handleImagesLoaded = useCallback(
    (rawImages) => {
      return addImages(rawImages);
    },
    [addImages],
  );

  const handleAddMoreViaDirectoryPicker = useCallback(async () => {
    try {
      const saved = await loadImagesFromSavedDirectory({
        promptForPermission: true,
      });
      if (saved.supported && saved.available && saved.granted) {
        if (saved.images.length > 0) {
          addImages(saved.images);
        }
        return true;
      }

      const result = await pickImagesFromDirectory();
      if (!result.supported) return false;
      if (!result.aborted && result.images.length > 0) {
        addImages(result.images);
      }
      return true;
    } catch (error) {
      console.error('Directory picker add-more error:', error);
      return false;
    }
  }, [addImages]);

  const handlePickFolderViaDirectoryPicker = useCallback(async () => {
    try {
      const result = await pickImagesFromDirectory();
      if (!result.supported) {
        return {
          handled: false,
          images: [],
          directoryName: '',
          directoryHandle: null,
        };
      }
      if (result.aborted) {
        return {
          handled: true,
          images: [],
          directoryName: '',
          directoryHandle: null,
        };
      }
      return {
        handled: true,
        images: result.images,
        directoryName: result.directoryName || '',
        directoryHandle: result.directoryHandle || null,
      };
    } catch (error) {
      console.error('Directory picker add-folder error:', error);
      return {
        handled: false,
        images: [],
        directoryName: '',
        directoryHandle: null,
      };
    }
  }, []);

  const handleUpdateFolderAccess = useCallback(async () => {
    try {
      const saved = await loadImagesFromSavedDirectory({
        promptForPermission: true,
      });
      if (saved.supported && saved.available && saved.granted) {
        return {
          handled: true,
          images: saved.images,
          directoryName: saved.directoryName || '',
          directoryHandle: saved.directoryHandle || null,
        };
      }

      const result = await pickImagesFromDirectory();
      if (!result.supported) {
        return {
          handled: false,
          images: [],
          directoryName: '',
          directoryHandle: null,
        };
      }
      if (result.aborted) {
        return {
          handled: true,
          images: [],
          directoryName: '',
          directoryHandle: null,
        };
      }
      return {
        handled: true,
        images: result.images,
        directoryName: result.directoryName || '',
        directoryHandle: result.directoryHandle || null,
      };
    } catch (error) {
      console.error('Directory picker update-access error:', error);
      return {
        handled: false,
        images: [],
        directoryName: '',
        directoryHandle: null,
      };
    }
  }, []);

  const restoreLastDirectoryIfAvailable = useCallback(async () => {
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
        };
      }
      if (saved.images.length > 0) {
        await addImages(saved.images);
        return {
          restored: true,
          images: saved.images,
          directoryName: saved.directoryName || '',
          directoryHandle: saved.directoryHandle || null,
        };
      }
      return {
        restored: false,
        images: [],
        directoryName: saved.directoryName || '',
        directoryHandle: saved.directoryHandle || null,
      };
    } catch {
      return {
        restored: false,
        images: [],
        directoryName: '',
        directoryHandle: null,
      };
    }
  }, [addImages]);

  const handleAddMore = useCallback(
    async (e) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      const images = imagesFromFileList(files, 'add-more');
      if (images.length > 0) addImages(images);
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
