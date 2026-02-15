import React from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';

const DangerZone = ({
  handleResetDraft,
  handleDelete,
  imageName
}) => {
  return (
    <section className="control-section danger-zone">
      <div className="action-row">
        <button
          className="btn btn-ghost btn-sm"
          onClick={handleResetDraft}
        >
          <RotateCcw size={14} />
          <span>Reset Draft</span>
        </button>
        <button
          className="btn btn-ghost btn-danger-ghost btn-sm"
          onClick={handleDelete}
        >
          <Trash2 size={14} />
          <span>Delete File</span>
        </button>
      </div>
    </section>
  );
};

export default DangerZone;
