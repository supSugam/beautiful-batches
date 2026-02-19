import { useCallback, useRef } from 'react';

/**
 * Lightweight pointer drag tracking hook.
 * Replaces react-advanced-cropper's DraggableArea.
 *
 * Uses refs for all callbacks so that event listeners added during
 * pointerdown always call the latest callback versions — no stale closures.
 */
export function usePointerDrag({ onMove, onMoveStart, onMoveEnd }) {
  const stateRef = useRef(null);
  const onMoveRef = useRef(onMove);
  const onMoveStartRef = useRef(onMoveStart);
  const onMoveEndRef = useRef(onMoveEnd);

  // Keep refs up-to-date every render
  onMoveRef.current = onMove;
  onMoveStartRef.current = onMoveStart;
  onMoveEndRef.current = onMoveEnd;

  // These are stable — they never re-create, so event listeners stay valid
  const handlePointerMove = useCallback((e) => {
    const s = stateRef.current;
    if (!s) return;
    e.preventDefault();

    const deltaX = e.clientX - s.lastX;
    const deltaY = e.clientY - s.lastY;
    s.lastX = e.clientX;
    s.lastY = e.clientY;

    onMoveRef.current?.({
      deltaX,
      deltaY,
      totalDeltaX: e.clientX - s.startX,
      totalDeltaY: e.clientY - s.startY,
      clientX: e.clientX,
      clientY: e.clientY,
    });
  }, []);

  const handlePointerUp = useCallback((e) => {
    const s = stateRef.current;
    if (!s) return;
    stateRef.current = null;

    const target = s.target;
    target.releasePointerCapture(e.pointerId);
    target.removeEventListener('pointermove', handlePointerMove);
    target.removeEventListener('pointerup', handlePointerUp);
    target.removeEventListener('pointercancel', handlePointerUp);

    onMoveEndRef.current?.({
      totalDeltaX: e.clientX - s.startX,
      totalDeltaY: e.clientY - s.startY,
      clientX: e.clientX,
      clientY: e.clientY,
    });
  }, []);

  const onPointerDown = useCallback((e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();

    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);

    stateRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      target,
    };

    target.addEventListener('pointermove', handlePointerMove);
    target.addEventListener('pointerup', handlePointerUp);
    target.addEventListener('pointercancel', handlePointerUp);

    onMoveStartRef.current?.({
      clientX: e.clientX,
      clientY: e.clientY,
    });
  }, []);

  return { onPointerDown };
}

export default usePointerDrag;
