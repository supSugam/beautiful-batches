import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  FolderOpen,
  ArrowUpDown,
  Clock3,
  Type,
  Scale,
  Check,
  ChevronDown,
  Grid3x3,
  Maximize,
  Download,
  Loader2,
} from 'lucide-react';
import './Toolbar.css';

const SORT_OPTIONS = [
  {
    value: 'last_modified',
    label: 'Last Modified (Newest)',
    Icon: Clock3,
  },
  {
    value: 'last_modified_oldest',
    label: 'Last Modified (Oldest)',
    Icon: Clock3,
  },
  {
    value: 'name_asc',
    label: 'Alphabet A-Z',
    Icon: Type,
  },
  {
    value: 'name_desc',
    label: 'Alphabet Z-A',
    Icon: Type,
  },
  {
    value: 'size_desc',
    label: 'Size Large-Small',
    Icon: Scale,
  },
  {
    value: 'size_asc',
    label: 'Size Small-Large',
    Icon: Scale,
  },
];

const truncateMiddle = (value, maxLength = 44) => {
  const text = String(value || '');
  if (text.length <= maxLength) return text;
  const tailLength = Math.max(10, Math.floor((maxLength - 1) * 0.4));
  const headLength = Math.max(10, maxLength - tailLength - 1);
  return `${text.slice(0, headLength)}…${text.slice(-tailLength)}`;
};

const Toolbar = ({
  folderName,
  sortOption,
  setSortOption,
  explorerOpen,
  onToggleExplorer,
  activeFolderLabel,
  rowHeight,
  setRowHeight,
  onExport,
  processing,
}) => {
  const [isSortMenuOpen, setIsSortMenuOpen] = useState(false);
  const sortMenuRef = useRef(null);

  const activeSortOption = useMemo(
    () =>
      SORT_OPTIONS.find((option) => option.value === sortOption) ||
      SORT_OPTIONS[0],
    [sortOption],
  );
  const folderPathRaw = useMemo(() => {
    const root = String(folderName || '').trim();
    const active = String(activeFolderLabel || '').trim();

    if (!active) return root;
    if (active.toLowerCase() === 'all images') return 'All Images';
    if (!root) return active;
    if (root.toLowerCase() === active.toLowerCase()) return root;
    return `${root} > ${active}`;
  }, [activeFolderLabel, folderName]);
  const folderPathLabel = useMemo(
    () => truncateMiddle(folderPathRaw, 44),
    [folderPathRaw],
  );

  useEffect(() => {
    if (!isSortMenuOpen) return undefined;

    const handlePointerDown = (event) => {
      if (!sortMenuRef.current) return;
      if (sortMenuRef.current.contains(event.target)) return;
      setIsSortMenuOpen(false);
    };

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsSortMenuOpen(false);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isSortMenuOpen]);

  return (
    <header className="toolbar">
      <div className="toolbar-section toolbar-meta">
        <button
          className={`btn-icon toolbar-explorer-toggle ${explorerOpen ? 'is-active' : ''}`}
          onClick={onToggleExplorer}
          title="Toggle folders sidebar (Ctrl/Cmd + B)"
          type="button"
          aria-label="Toggle folders sidebar"
          aria-pressed={explorerOpen}
        >
          <FolderOpen size={14} />
        </button>
        <div className="toolbar-divider" />
        <FolderOpen size={15} className="toolbar-dim" />
        <span className="toolbar-folder-path" title={folderPathRaw}>
          {folderPathLabel}
        </span>
      </div>

      <div className="toolbar-section toolbar-controls">
        <div
          className={`toolbar-sort-wrap ${isSortMenuOpen ? 'is-open' : ''}`}
          ref={sortMenuRef}
        >
          <button
            type="button"
            className="toolbar-sort-trigger"
            onClick={() => setIsSortMenuOpen((prev) => !prev)}
            title="Sort gallery"
          >
            <ArrowUpDown size={14} />
            <span className="toolbar-sort-trigger-prefix">Sort</span>
            <span className="toolbar-sort-trigger-label">
              {activeSortOption.label}
            </span>
            <ChevronDown size={14} className="toolbar-sort-chevron" />
          </button>

          {isSortMenuOpen && (
            <div className="toolbar-sort-menu" role="menu" aria-label="Sort options">
              {SORT_OPTIONS.map((option) => {
                const isActive = option.value === sortOption;
                const IconComponent = option.Icon;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={isActive}
                    className={`toolbar-sort-option ${isActive ? 'is-active' : ''}`}
                    onClick={() => {
                      setSortOption(option.value);
                      setIsSortMenuOpen(false);
                    }}
                  >
                    <span className="toolbar-sort-option-main">
                      <span className="toolbar-sort-option-icon">
                        <IconComponent size={13} />
                      </span>
                      <span className="toolbar-sort-option-label">{option.label}</span>
                    </span>
                    <span className="toolbar-sort-option-state">
                      {isActive && <Check size={13} />}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="control-group">
          <Grid3x3 size={13} className="toolbar-dim" />
          <input
            type="range"
            className="size-slider"
            min={150}
            max={500}
            value={rowHeight}
            onChange={(e) => setRowHeight(Number(e.target.value))}
          />
          <Maximize size={14} className="toolbar-dim" />
        </div>
      </div>

      <div className="toolbar-section toolbar-actions">
        <button
          className="btn btn-primary"
          onClick={onExport}
          disabled={!!processing}
        >
          {processing ? (
            <>
              <Loader2 size={14} className="spin" />
              <span>
                {processing.current}/{processing.total}
              </span>
            </>
          ) : (
            <>
              <Download size={14} />
              <span>Export All</span>
            </>
          )}
        </button>
      </div>
    </header>
  );
};

export default Toolbar;
