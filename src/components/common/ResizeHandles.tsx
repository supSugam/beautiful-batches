import React from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import './ResizeHandles.css';

/**
 * ResizeHandles component for frameless windows.
 * Adds invisible touch targets at the edges of the window to trigger native resizing.
 */
const ResizeHandles: React.FC = () => {
  const handleResize = (direction: string) => {
    // @ts-ignore - Tauri v2 API
    getCurrentWindow().startResizing(direction).catch(console.error);
  };

  return (
    <div className="resize-handles-container">
      {/* Edges */}
      <div className="resize-handle top" onPointerDown={() => handleResize('North')} />
      <div className="resize-handle bottom" onPointerDown={() => handleResize('South')} />
      <div className="resize-handle left" onPointerDown={() => handleResize('West')} />
      <div className="resize-handle right" onPointerDown={() => handleResize('East')} />

      {/* Corners */}
      <div className="resize-handle top-left" onPointerDown={() => handleResize('NorthWest')} />
      <div className="resize-handle top-right" onPointerDown={() => handleResize('NorthEast')} />
      <div className="resize-handle bottom-left" onPointerDown={() => handleResize('SouthWest')} />
      <div className="resize-handle bottom-right" onPointerDown={() => handleResize('SouthEast')} />
    </div>
  );
};

export default ResizeHandles;
