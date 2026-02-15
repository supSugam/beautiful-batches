import { create } from 'zustand';

// Helper for loading natural dimensions (copied from App.jsx for consistency)
function loadImageWithDimensions(file, id, relativePath) {
  return new Promise((resolve) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      resolve({
        id,
        name: file.name,
        relativePath,
        objectUrl,
        file,
        naturalWidth: img.naturalWidth,
        naturalHeight: img.naturalHeight,
        naturalRatio: img.naturalWidth / img.naturalHeight,
      });
    };
    img.onerror = () => {
      resolve({
        id,
        name: file.name,
        relativePath,
        objectUrl,
        file,
        naturalWidth: 1,
        naturalHeight: 1,
        naturalRatio: 1,
      });
    };
    img.src = objectUrl;
  });
}

const useStore = create((set, get) => ({
  // --- Global State ---
  images: [],
  cropData: new Map(),
  selectedId: null,
  processing: null,

  // --- UI Settings ---
  rowHeight: 250,
  format: 'png',
  quality: 90,
  showAllFooters: true,
  inspectorWidth: 900,

  // --- Actions ---
  
  // Images
  setImages: (images) => set({ images }),
  
  addImages: async (rawImages) => {
    const withDims = await Promise.all(
      rawImages.map((img) =>
        loadImageWithDimensions(img.file, img.id, img.relativePath)
      )
    );
    set((state) => ({ images: [...state.images, ...withDims] }));
  },

  deleteImage: (id) => {
    const { images, cropData, selectedId } = get();
    const img = images.find((i) => i.id === id);
    if (img?.objectUrl) URL.revokeObjectURL(img.objectUrl);
    
    const newCropData = new Map(cropData);
    newCropData.delete(id);
    
    set({
      images: images.filter((i) => i.id !== id),
      cropData: newCropData,
      selectedId: selectedId === id ? null : selectedId
    });
  },

  clearAll: () => {
    const { images } = get();
    images.forEach((img) => {
      if (img.objectUrl) URL.revokeObjectURL(img.objectUrl);
    });
    set({ images: [], cropData: new Map(), selectedId: null });
  },

  // Selection
  setSelectedId: (id) => set({ selectedId: id }),
  
  selectNext: () => {
    const { images, selectedId } = get();
    if (!selectedId) return;
    const idx = images.findIndex((img) => img.id === selectedId);
    if (idx < images.length - 1) set({ selectedId: images[idx + 1].id });
  },

  selectPrev: () => {
    const { images, selectedId } = get();
    if (!selectedId) return;
    const idx = images.findIndex((img) => img.id === selectedId);
    if (idx > 0) set({ selectedId: images[idx - 1].id });
  },

  // Crop Data
  setCropChange: (id, coords) => {
    set((state) => {
      const next = new Map(state.cropData);
      next.set(id, coords);
      return { cropData: next };
    });
  },

  applyCropToImages: (sourceId, targetIds) => {
    const { images, cropData } = get();
    const sourceData = cropData.get(sourceId);
    if (!sourceData) return;

    const sourceImg = images.find((img) => img.id === sourceId);
    if (!sourceImg) return;

    const transforms = sourceData.transforms || {
      rotate: 0,
      flip: { horizontal: false, vertical: false },
    };
    const { rotate } = transforms;
    const isRotated90 = rotate % 180 === 90;
    const sourceW = isRotated90 ? sourceImg.naturalHeight : sourceImg.naturalWidth;
    const sourceH = isRotated90 ? sourceImg.naturalWidth : sourceImg.naturalHeight;

    const relLeft = sourceData.coordinates.left / sourceW;
    const relTop = sourceData.coordinates.top / sourceH;
    const relWidth = sourceData.coordinates.width / sourceW;
    const relHeight = sourceData.coordinates.height / sourceH;

    set((state) => {
      const next = new Map(state.cropData);
      targetIds.forEach((id) => {
        const targetImg = images.find((img) => img.id === id);
        if (!targetImg) return;

        const targetW = isRotated90 ? targetImg.naturalHeight : targetImg.naturalWidth;
        const targetH = isRotated90 ? targetImg.naturalWidth : targetImg.naturalHeight;

        next.set(id, {
          ...sourceData,
          coordinates: {
            left: Math.round(relLeft * targetW),
            top: Math.round(relTop * targetH),
            width: Math.round(relWidth * targetW),
            height: Math.round(relHeight * targetH),
          },
        });
      });
      return { cropData: next };
    });
  },

  // UI Settings
  setRowHeight: (rowHeight) => set({ rowHeight }),
  setFormat: (format) => set({ format }),
  setQuality: (quality) => set({ quality }),
  setShowAllFooters: (showAllFooters) => set({ showAllFooters }),
  setInspectorWidth: (inspectorWidth) => set({ inspectorWidth }),
  setProcessing: (processing) => set({ processing }),
}));

export default useStore;
