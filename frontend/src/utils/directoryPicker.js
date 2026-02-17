export const IMAGE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.webp',
  '.avif',
]);

export const ACCEPTED_IMAGE_TYPES = '.png,.jpg,.jpeg,.webp,.avif';
const HANDLE_DB_NAME = 'beautiful-batches-fs-handles';
const HANDLE_DB_VERSION = 1;
const HANDLE_STORE_NAME = 'directory-handles';
const LAST_HANDLE_KEY = 'last-source-directory';
const DIRECTORY_PICKER_ID = 'beautiful-batches-source';

let uploadSequence = 0;

const normalizePath = (value) => String(value || '').replace(/\\/g, '/');

const getExtension = (filename) => {
  const safeName = String(filename || '');
  const dotIndex = safeName.lastIndexOf('.');
  if (dotIndex < 0) return '';
  return safeName.slice(dotIndex).toLowerCase();
};

const buildUploadId = (prefix, relativePath) => {
  uploadSequence += 1;
  return `${prefix}-${Date.now()}-${uploadSequence}-${relativePath}`;
};

export const isImageFile = (file) => {
  if (!file) return false;
  return IMAGE_EXTENSIONS.has(getExtension(file.name));
};

export const imagesFromFileList = (fileList, prefix = 'files') => {
  if (!fileList || typeof fileList.length !== 'number') return [];

  const images = [];
  for (let index = 0; index < fileList.length; index += 1) {
    const file = fileList[index];
    if (!isImageFile(file)) continue;
    const relativePath = normalizePath(file.webkitRelativePath || file.name);
    images.push({
      file,
      id: buildUploadId(prefix, relativePath),
      relativePath,
    });
  }
  return images;
};

const canUseFsDirectoryPicker = () =>
  typeof window !== 'undefined' &&
  typeof window.showDirectoryPicker === 'function';

const canUseIndexedDb = () =>
  typeof window !== 'undefined' && 'indexedDB' in window;

const openHandleDb = () =>
  new Promise((resolve, reject) => {
    if (!canUseIndexedDb()) {
      resolve(null);
      return;
    }

    const request = window.indexedDB.open(HANDLE_DB_NAME, HANDLE_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(HANDLE_STORE_NAME)) {
        db.createObjectStore(HANDLE_STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const idbGet = (db, key) =>
  new Promise((resolve, reject) => {
    if (!db) {
      resolve(null);
      return;
    }
    const tx = db.transaction(HANDLE_STORE_NAME, 'readonly');
    const store = tx.objectStore(HANDLE_STORE_NAME);
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });

const idbSet = (db, key, value) =>
  new Promise((resolve, reject) => {
    if (!db) {
      resolve(false);
      return;
    }
    const tx = db.transaction(HANDLE_STORE_NAME, 'readwrite');
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
    tx.objectStore(HANDLE_STORE_NAME).put(value, key);
  });

const idbDelete = (db, key) =>
  new Promise((resolve, reject) => {
    if (!db) {
      resolve(false);
      return;
    }
    const tx = db.transaction(HANDLE_STORE_NAME, 'readwrite');
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
    tx.objectStore(HANDLE_STORE_NAME).delete(key);
  });

const getDirectoryPermissionState = async (directoryHandle, prompt = false) => {
  if (!directoryHandle) return 'denied';

  const options = { mode: 'read' };
  if (typeof directoryHandle.queryPermission === 'function') {
    const current = await directoryHandle.queryPermission(options);
    if (current === 'granted' || current === 'denied') return current;
  }

  if (!prompt || typeof directoryHandle.requestPermission !== 'function') {
    return 'prompt';
  }

  return directoryHandle.requestPermission(options);
};

const saveDirectoryHandle = async (directoryHandle) => {
  if (!directoryHandle || !canUseIndexedDb()) return false;
  let db = null;
  try {
    db = await openHandleDb();
    if (!db) return false;
    await idbSet(db, LAST_HANDLE_KEY, directoryHandle);
    if (
      typeof navigator !== 'undefined' &&
      navigator.storage &&
      typeof navigator.storage.persist === 'function'
    ) {
      navigator.storage.persist().catch(() => {});
    }
    return true;
  } catch (error) {
    console.warn('Failed to persist directory handle:', error);
    return false;
  } finally {
    if (db) db.close();
  }
};

const getSavedDirectoryHandle = async () => {
  if (!canUseIndexedDb()) return null;
  let db = null;
  try {
    db = await openHandleDb();
    if (!db) return null;
    return await idbGet(db, LAST_HANDLE_KEY);
  } catch {
    return null;
  } finally {
    if (db) db.close();
  }
};

export const clearSavedDirectoryHandle = async () => {
  if (!canUseIndexedDb()) return false;
  let db = null;
  try {
    db = await openHandleDb();
    if (!db) return false;
    await idbDelete(db, LAST_HANDLE_KEY);
    return true;
  } catch {
    return false;
  } finally {
    if (db) db.close();
  }
};

export const clearSavedDirectoryHandleIfMatches = async (directoryHandle) => {
  if (!directoryHandle) return false;

  const savedHandle = await getSavedDirectoryHandle();
  if (!savedHandle) return false;

  let matches = false;
  try {
    if (typeof savedHandle.isSameEntry === 'function') {
      matches = await savedHandle.isSameEntry(directoryHandle);
    } else if (typeof directoryHandle.isSameEntry === 'function') {
      matches = await directoryHandle.isSameEntry(savedHandle);
    }
  } catch {
    matches = false;
  }

  if (!matches) return false;
  return clearSavedDirectoryHandle();
};

const walkDirectory = async (directoryHandle, pathSegments, collector) => {
  for await (const [entryName, entryHandle] of directoryHandle.entries()) {
    if (entryHandle.kind === 'directory') {
      await walkDirectory(entryHandle, [...pathSegments, entryName], collector);
      continue;
    }

    if (entryHandle.kind !== 'file') continue;

    const file = await entryHandle.getFile();
    if (!isImageFile(file)) continue;

    const relativePath = normalizePath([...pathSegments, file.name].join('/'));
    collector.push({
      file,
      id: buildUploadId('dir', relativePath),
      relativePath,
    });
  }
};

export const pickImagesFromDirectory = async () => {
  if (!canUseFsDirectoryPicker()) {
    return { supported: false, aborted: false, images: [] };
  }

  try {
    const directoryHandle = await window.showDirectoryPicker({
      id: DIRECTORY_PICKER_ID,
      mode: 'read',
    });
    await getDirectoryPermissionState(directoryHandle, true);
    await saveDirectoryHandle(directoryHandle);
    const images = [];
    await walkDirectory(directoryHandle, [directoryHandle.name], images);
    return {
      supported: true,
      aborted: false,
      images,
      directoryName: directoryHandle.name,
      directoryHandle,
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      return { supported: true, aborted: true, images: [] };
    }
    throw error;
  }
};

export const loadImagesFromSavedDirectory = async (
  { promptForPermission = false } = {},
) => {
  if (!canUseFsDirectoryPicker()) {
    return {
      supported: false,
      available: false,
      granted: false,
      images: [],
    };
  }

  const directoryHandle = await getSavedDirectoryHandle();
  if (!directoryHandle) {
    return {
      supported: true,
      available: false,
      granted: false,
      images: [],
    };
  }

  try {
    const permission = await getDirectoryPermissionState(
      directoryHandle,
      promptForPermission,
    );
    if (permission !== 'granted') {
      return {
        supported: true,
        available: true,
        granted: false,
        images: [],
      };
    }

    const images = [];
    await walkDirectory(directoryHandle, [directoryHandle.name], images);
    return {
      supported: true,
      available: true,
      granted: true,
      images,
      directoryName: directoryHandle.name,
      directoryHandle,
    };
  } catch {
    return {
      supported: true,
      available: false,
      granted: false,
      images: [],
    };
  }
};
