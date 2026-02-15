import React from 'react';
import './ProgressBar.css';

const ProgressBar = ({ current, total }) => {
  if (!total) return null;
  const progress = (current / total) * 100;

  return (
    <div className="progress-bar">
      <div
        className="progress-fill"
        style={{
          width: `${progress}%`,
        }}
      />
    </div>
  );
};

export default ProgressBar;
