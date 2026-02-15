import React from 'react';

import {
  RotateCw,
  MoveHorizontal as FlipHorizontalIcon,
  MoveVertical as FlipVerticalIcon,
  RefreshCcw,
} from 'lucide-react';
import { RotateComponent } from './RotateComponent';

const TransformControls = ({
  rotation,
  handleRotate,
  handleRotateDelta,
  handleRotateEnd,
  flip,
  handleFlip,
  handleResetTransforms,
}) => {
  const [quarter, setQuarter] = React.useState(0);
  const [adjustmentAngle, setAdjustmentAngle] = React.useState(0);
  const rotateComponentRef = React.useRef(null);

  React.useLayoutEffect(() => {
    const absRotate = Math.abs(rotation);
    let rotate;
    if (absRotate % 90 > 45) {
      rotate = (absRotate - (absRotate % 90) + 90) / 90;
    } else if (absRotate % 90 < 45) {
      rotate = (absRotate - (absRotate % 90)) / 90;
    } else {
      rotate = quarter;
    }
    rotate = Math.sign(rotation) * rotate;

    if (rotate !== quarter) {
      setQuarter(rotate);
    }
    setAdjustmentAngle(
      Math.sign(rotation) * (Math.abs(rotation) - Math.abs(rotate) * 90),
    );
  }, [rotation]);

  const rotateTo = (angle) => {
    if (handleRotateDelta) {
      handleRotateDelta(angle, {
        transitions: false,
        interaction: true,
        immediately: true,
      });
    }
  };

  return (
    <section className="control-section">
      <h3 className="section-label">Transform</h3>
      <div className="icon-action-row" style={{ marginBottom: '0.75rem' }}>
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
            <FlipHorizontalIcon size={18} />
          </button>
          <button
            className={`btn-icon-box ${flip.vertical ? 'active' : ''}`}
            title="Flip Vertical"
            onClick={() => handleFlip(false)}
          >
            <FlipVerticalIcon size={18} />
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

      <div style={{ padding: '0 4px' }}>
        <RotateComponent
          ref={rotateComponentRef}
          value={adjustmentAngle}
          onChange={rotateTo}
          onBlur={handleRotateEnd}
          from={-45}
          to={45}
        />
      </div>
    </section>
  );
};

export default React.memo(TransformControls);
