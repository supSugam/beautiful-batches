import { useState, useCallback, useEffect } from 'react';

export const useSidebarResize = (onResize) => {
  const [isResizing, setIsResizing] = useState(false);

  const startResizing = useCallback((e) => {
    e.preventDefault();
    setIsResizing(true);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    const doResize = (e) => {
      const newWidth = window.innerWidth - e.clientX;
      const minW = window.innerWidth * 0.4;
      const maxW = window.innerWidth * 0.9;
      onResize(Math.max(minW, Math.min(newWidth, maxW)));
    };

    const stopResize = () => {
      setIsResizing(false);
      document.body.style.cursor = 'default';
    };

    document.body.style.cursor = 'col-resize';
    window.addEventListener('mousemove', doResize);
    window.addEventListener('mouseup', stopResize);

    return () => {
      window.removeEventListener('mousemove', doResize);
      window.removeEventListener('mouseup', stopResize);
    };
  }, [isResizing, onResize]);

  return { isResizing, startResizing };
};
