import type {
  CropEntry,
  FolderDraftSummary,
  GalleryImage,
  ResolvedDraftsById,
} from '../types/app';

const DRAFT_DB_NAME = 'beautiful-batches-edit-drafts';
const DRAFT_DB_VERSION = 1;
const DRAFT_STORE = 'folder-drafts';
const DRAFT_SCHEMA_VERSION = 1;
const LOCAL_STORAGE_PREFIX = 'bb-folder-draft:';

type PersistedDraftImageEntry = {
  crop: CropEntry | null;
  caption: string;
  sourceLastModified: number;
  sourceSize: number;
  modifiedAt: number;
};

type FolderDraftPayload = {
  version: number;
  folderPath: string;
  updatedAt: number;
  images: Record<string, PersistedDraftImageEntry>;
};

type FolderDraftPayloadByPath = Record<string, FolderDraftPayload>;

type BuildDraftPayloadArgs = {
  images: GalleryImage[];
  cropData: Map<string, CropEntry>;
  captionById: Map<string, string>;
  sessionModifiedAt: Map<string, number>;
};

const normalizePath = (value: unknown): string => String(value || '').replace(/\\/g, '/');

const getRootFolderPath = (relativePath: string): string => {
  const normalized = normalizePath(relativePath);
  const first = normalized.split('/').filter(Boolean)[0];
  return first || '';
};

const safeClone = <T>(value: T): T | null => {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return null;
  }
};

const canUseIndexedDb = () =>
  typeof window !== 'undefined' && 'indexedDB' in window;

const openDraftDb = () =>
  new Promise<IDBDatabase | null>((resolve, reject) => {
    if (!canUseIndexedDb()) {
      resolve(null);
      return;
    }

    const request = window.indexedDB.open(DRAFT_DB_NAME, DRAFT_DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(DRAFT_STORE)) {
        db.createObjectStore(DRAFT_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const idbGet = <T>(db: IDBDatabase | null, key: string) =>
  new Promise<T | null>((resolve, reject) => {
    if (!db) {
      resolve(null);
      return;
    }
    const tx = db.transaction(DRAFT_STORE, 'readonly');
    const request = tx.objectStore(DRAFT_STORE).get(key);
    request.onsuccess = () => resolve(request.result ?? null);
    request.onerror = () => reject(request.error);
  });

const idbSet = (db: IDBDatabase | null, key: string, value: unknown) =>
  new Promise<boolean>((resolve, reject) => {
    if (!db) {
      resolve(false);
      return;
    }
    const tx = db.transaction(DRAFT_STORE, 'readwrite');
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
    tx.objectStore(DRAFT_STORE).put(value, key);
  });

const localStorageKey = (folderPath: string) =>
  `${LOCAL_STORAGE_PREFIX}${normalizePath(folderPath)}`;

const readLocalStorageDraft = (folderPath: string): FolderDraftPayload | null => {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(localStorageKey(folderPath));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as FolderDraftPayload;
  } catch {
    return null;
  }
};

const writeLocalStorageDraft = (
  folderPath: string,
  payload: FolderDraftPayload,
): boolean => {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(
      localStorageKey(folderPath),
      JSON.stringify(payload),
    );
    return true;
  } catch {
    return false;
  }
};

const normalizePersistedPayload = (
  folderPath: string,
  rawPayload: unknown,
): FolderDraftPayload | null => {
  if (!rawPayload || typeof rawPayload !== 'object') return null;
  const candidate = rawPayload as Partial<FolderDraftPayload>;
  if (Number(candidate.version || 0) !== DRAFT_SCHEMA_VERSION) return null;
  if (!candidate.images || typeof candidate.images !== 'object') return null;

  const normalizedFolderPath = normalizePath(folderPath);
  const nextImages: Record<string, PersistedDraftImageEntry> = {};
  Object.entries(candidate.images).forEach(([relativePath, value]) => {
    if (!value || typeof value !== 'object') return;
    const normalizedPath = normalizePath(relativePath);
    if (!normalizedPath) return;

    const rawEntry = value as Partial<PersistedDraftImageEntry>;
    const crop = safeClone(rawEntry.crop);
    const caption = typeof rawEntry.caption === 'string' ? rawEntry.caption : '';
    const sourceLastModified = Number(rawEntry.sourceLastModified || 0) || 0;
    const sourceSize = Number(rawEntry.sourceSize || 0) || 0;
    const modifiedAt = Number(rawEntry.modifiedAt || 0) || 0;

    if (!crop && caption.trim() === '') return;

    nextImages[normalizedPath] = {
      crop,
      caption,
      sourceLastModified,
      sourceSize,
      modifiedAt,
    };
  });

  return {
    version: DRAFT_SCHEMA_VERSION,
    folderPath: normalizedFolderPath,
    updatedAt: Number(candidate.updatedAt || 0) || 0,
    images: nextImages,
  };
};

const buildDraftPayloadByFolder = ({
  images,
  cropData,
  captionById,
  sessionModifiedAt,
}: BuildDraftPayloadArgs) => {
  const folderPayloads = new Map<string, FolderDraftPayload>();
  const loadedRootPaths = new Set<string>();

  images.forEach((image) => {
    const relativePath = normalizePath(image?.relativePath);
    if (!relativePath) return;
    const folderPath = getRootFolderPath(relativePath);
    if (!folderPath) return;
    loadedRootPaths.add(folderPath);

    if (!folderPayloads.has(folderPath)) {
      folderPayloads.set(folderPath, {
        version: DRAFT_SCHEMA_VERSION,
        folderPath,
        updatedAt: Date.now(),
        images: {},
      });
    }

    const isModified = sessionModifiedAt.has(image.id);
    const caption = String(captionById.get(image.id) || '');
    const crop = cropData.get(image.id);
    if (!isModified && caption.trim() === '') return;

    const safeCrop = safeClone(crop);
    if (!safeCrop && caption.trim() === '') return;

    const folderPayload = folderPayloads.get(folderPath);
    if (!folderPayload) return;

    folderPayload.images[relativePath] = {
      crop: safeCrop,
      caption,
      sourceLastModified: Number(image?.sourceLastModified || 0) || 0,
      sourceSize: Number(image?.sourceSize || 0) || 0,
      modifiedAt: Number(sessionModifiedAt.get(image.id) || 0) || Date.now(),
    };
  });

  return {
    folderPayloads,
    loadedRootPaths: Array.from(loadedRootPaths),
  };
};

export const persistFolderDrafts = async ({
  images,
  cropData,
  captionById,
  sessionModifiedAt,
}: BuildDraftPayloadArgs): Promise<void> => {
  if (!Array.isArray(images) || images.length === 0) return;
  if (!(cropData instanceof Map)) return;
  if (!(captionById instanceof Map)) return;
  if (!(sessionModifiedAt instanceof Map)) return;

  const { folderPayloads, loadedRootPaths } = buildDraftPayloadByFolder({
    images,
    cropData,
    captionById,
    sessionModifiedAt,
  });

  let db: IDBDatabase | null = null;
  try {
    if (canUseIndexedDb()) {
      db = await openDraftDb();
    }

    for (const folderPath of loadedRootPaths) {
      const payload = folderPayloads.get(folderPath);
      const hasEntries = payload && Object.keys(payload.images).length > 0;
      if (!hasEntries) continue;
      if (db) {
        await idbSet(db, folderPath, payload);
      } else {
        writeLocalStorageDraft(folderPath, payload);
      }
    }
  } catch (error) {
    console.warn('Failed to persist folder drafts:', error);
  } finally {
    if (db) db.close();
  }
};

const loadFolderDraft = async (
  db: IDBDatabase | null,
  folderPath: string,
): Promise<FolderDraftPayload | null> => {
  if (db) return idbGet<FolderDraftPayload>(db, folderPath);
  return readLocalStorageDraft(folderPath);
};

export const loadFolderDraftSummaries = async (
  folderPaths: string[],
): Promise<FolderDraftSummary[]> => {
  const normalized = (Array.isArray(folderPaths) ? folderPaths : [])
    .map((value) => normalizePath(value))
    .filter(Boolean);
  if (normalized.length === 0) return [];

  let db: IDBDatabase | null = null;
  const summaries: FolderDraftSummary[] = [];
  try {
    if (canUseIndexedDb()) {
      db = await openDraftDb();
    }

    for (const folderPath of normalized) {
      const raw = await loadFolderDraft(db, folderPath);
      const payload = normalizePersistedPayload(folderPath, raw);
      if (!payload) continue;
      const count = Object.keys(payload.images).length;
      if (count <= 0) continue;
      summaries.push({
        folderPath,
        count,
        updatedAt: payload.updatedAt || 0,
      });
    }
  } catch (error) {
    console.warn('Failed to load folder draft summaries:', error);
  } finally {
    if (db) db.close();
  }

  return summaries;
};

export const loadFolderDraftPayloads = async (
  folderPaths: string[],
): Promise<FolderDraftPayloadByPath> => {
  const normalized = (Array.isArray(folderPaths) ? folderPaths : [])
    .map((value) => normalizePath(value))
    .filter(Boolean);
  if (normalized.length === 0) return {};

  let db: IDBDatabase | null = null;
  const payloads: FolderDraftPayloadByPath = {};
  try {
    if (canUseIndexedDb()) {
      db = await openDraftDb();
    }

    for (const folderPath of normalized) {
      const raw = await loadFolderDraft(db, folderPath);
      const payload = normalizePersistedPayload(folderPath, raw);
      if (!payload) continue;
      payloads[folderPath] = payload;
    }
  } catch (error) {
    console.warn('Failed to load folder draft payloads:', error);
  } finally {
    if (db) db.close();
  }

  return payloads;
};

const signatureMatches = (
  draftEntry: PersistedDraftImageEntry,
  image: GalleryImage,
): boolean => {
  const draftModified = Number(draftEntry?.sourceLastModified || 0) || 0;
  const draftSize = Number(draftEntry?.sourceSize || 0) || 0;
  const imageModified = Number(image?.sourceLastModified || 0) || 0;
  const imageSize = Number(image?.sourceSize || 0) || 0;

  if (draftModified > 0 && imageModified > 0 && draftModified !== imageModified) {
    return false;
  }
  if (draftSize > 0 && imageSize > 0 && draftSize !== imageSize) {
    return false;
  }
  return true;
};

export const resolveDraftsForImages = ({
  images,
  folderDraftPayloads,
}: {
  images: GalleryImage[];
  folderDraftPayloads: FolderDraftPayloadByPath;
}): ResolvedDraftsById => {
  const cropEntriesById: Record<string, CropEntry> = {};
  const captionsById: Record<string, string> = {};
  const modifiedAtById: Record<string, number> = {};
  let restoredCount = 0;

  images.forEach((image) => {
    const relativePath = normalizePath(image?.relativePath);
    if (!relativePath) return;
    const folderPath = getRootFolderPath(relativePath);
    if (!folderPath) return;
    const payload = folderDraftPayloads?.[folderPath];
    if (!payload?.images) return;

    const entry = payload.images[relativePath];
    if (!entry || !signatureMatches(entry, image)) return;

    if (entry.crop && typeof entry.crop === 'object') {
      const clonedCrop = safeClone(entry.crop);
      if (clonedCrop && typeof clonedCrop === 'object') {
        cropEntriesById[image.id] = clonedCrop;
        restoredCount += 1;
      }
    }
    if (typeof entry.caption === 'string') {
      captionsById[image.id] = entry.caption;
    }
    modifiedAtById[image.id] =
      Number(entry.modifiedAt || 0) ||
      Number(payload.updatedAt || 0) ||
      Date.now();
  });

  return {
    cropEntriesById,
    captionsById,
    modifiedAtById,
    restoredCount,
  };
};
