import React from 'react';
import './ProgressBar.css';

type ProgressBarProps = {
  current?: number;
  total?: number;
};

const ProgressBar = ({ current = 0, total = 0 }: ProgressBarProps) => {
  if (!total || total <= 0) return null;
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
