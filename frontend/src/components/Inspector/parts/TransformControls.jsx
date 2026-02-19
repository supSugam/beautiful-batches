import React from 'react';
import {
  RotateCcw,
  RotateCw,
  FlipHorizontal,
  FlipVertical,
  RefreshCw,
  Maximize,
} from 'lucide-react';
import { RotateComponent } from './RotateComponent';

/**
 * TransformControls — rotation buttons, rotation slider, flip buttons, reset.
 *
 * Props:
 *  - rotation           — current total rotation in degrees
 *  - fineRotation       — fine rotation value for slider display (-45 to 45)
 *  - handleRotate       — (delta) for ±90° button clicks
 *  - handleRotateDelta  — (delta) fine rotation from slider
 *  - handleRotateEnd    — called when slider drag ends
 *  - flip               — { horizontal, vertical }
 *  - handleFlip         — ('horizontal' | 'vertical') toggle a flip axis
 *  - handleResetTransforms — reset all transforms
 */
const TransformControls = ({
  rotation,
  fineRotation = 0,
  handleRotate,
  handleRotateDelta,
  handleRotateEnd,
  flip,
  handleFlip,
  handleFillZoom,
  handleResetTransforms,
}) => {
  return (
    <section className="control-section">
      <div className="section-header">
        <h3 className="section-label">Transform</h3>
        <div className="section-header-tools">
          <button
            className="btn-icon-subtle"
            onClick={handleResetTransforms}
            title={`Reset Transforms (${Number(rotation || 0).toFixed(1)}°)`}
          >
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      <div className="icon-action-row">
        <div className="icon-action-row-inner">
          <button
            className="btn-icon-box"
            onClick={() => handleRotate(-90)}
            title="Rotate -90°"
          >
            <RotateCcw size={16} />
          </button>
          <button
            className="btn-icon-box"
            onClick={() => handleRotate(90)}
            title="Rotate +90°"
          >
            <RotateCw size={16} />
          </button>
          <button
            className={`btn-icon-box ${flip?.horizontal ? 'active' : ''}`}
            onClick={() => handleFlip('horizontal')}
            title="Flip Horizontal"
          >
            <FlipHorizontal size={16} />
          </button>
          <button
            className={`btn-icon-box ${flip?.vertical ? 'active' : ''}`}
            onClick={() => handleFlip('vertical')}
            title="Flip Vertical"
          >
            <FlipVertical size={16} />
          </button>
          <button
            className="btn-icon-box"
            onClick={handleFillZoom}
            title="Fill to hide blanks"
          >
            <Maximize size={16} />
          </button>
        </div>

        <RotateComponent
          from={-45}
          to={45}
          value={fineRotation}
          onChange={handleRotateDelta}
          onBlur={handleRotateEnd}
        />
      </div>
    </section>
  );
};

export default React.memo(TransformControls);
