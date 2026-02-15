import React from 'react';
import { RotateCw, FlipHorizontal, FlipVertical, RefreshCcw } from 'lucide-react';

const TransformControls = ({
  handleRotate,
  flip,
  handleFlip,
  handleResetTransforms
}) => {
  return (
    <section className="control-section">
      <h3 className="section-label">Transform</h3>
      <div className="icon-action-row">
        <div className="icon-action-row-inner" style={{ flex: 1 }}>
          <button
            className="btn-icon-box"
            onClick={handleRotate}
            title="Rotate 90° Clockwise"
          >
            <RotateCw size={18} />
          </button>
          <button
            className={`btn-icon-box ${flip.horizontal ? 'active' : ''}`}
            title="Flip Horizontal"
            onClick={() => handleFlip(true)}
          >
            <FlipHorizontal size={18} />
          </button>
          <button
            className={`btn-icon-box ${flip.vertical ? 'active' : ''}`}
            title="Flip Vertical"
            onClick={() => handleFlip(false)}
          >
            <FlipVertical size={18} />
          </button>
          <button
            className="btn-icon-box"
            title="Reset Transforms"
            onClick={handleResetTransforms}
            style={{ flex: 0, minWidth: '44px' }}
          >
            <RefreshCcw size={18} />
          </button>
        </div>
      </div>
    </section>
  );
};

export default TransformControls;
