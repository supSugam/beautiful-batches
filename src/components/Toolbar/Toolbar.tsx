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
  Maximize as MaximizeIcon,
  X,
  Minus,
  Square,
} from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { LucideIcon } from 'lucide-react';
import type { SortOption } from '../../types/app';
import './Toolbar.css';

const MIN_ROW_HEIGHT = 150;
const MAX_ROW_HEIGHT = 500;
const ROW_HEIGHT_STEP = 4;
const snapRowHeight = (value: number): number => {
  const safeValue = Number.isFinite(value) ? value : MIN_ROW_HEIGHT;
  const clamped = Math.max(MIN_ROW_HEIGHT, Math.min(MAX_ROW_HEIGHT, safeValue));
  const snapped =
    MIN_ROW_HEIGHT +
    Math.round((clamped - MIN_ROW_HEIGHT) / ROW_HEIGHT_STEP) * ROW_HEIGHT_STEP;
  return Math.max(MIN_ROW_HEIGHT, Math.min(MAX_ROW_HEIGHT, snapped));
};

const SORT_OPTIONS: Array<{
  value: SortOption;
  label: string;
  Icon: LucideIcon;
}> = [
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

const truncateMiddle = (value: string, maxLength = 44): string => {
  const text = String(value || '');
  if (text.length <= maxLength) return text;
  const tailLength = Math.max(10, Math.floor((maxLength - 1) * 0.4));
  const headLength = Math.max(10, maxLength - tailLength - 1);
  return `${text.slice(0, headLength)}…${text.slice(-tailLength)}`;
};

type ToolbarProps = {
  folderName: string;
  sortOption: SortOption;
  setSortOption: (option: SortOption) => void;
  explorerOpen: boolean;
  onToggleExplorer: () => void;
  activeFolderLabel: string;
  activeFolderPathOnDisk?: string;
  canOpenFolderPath?: boolean;
  onOpenFolderPath?: () => void;
  rowHeight: number;
  setRowHeight: (value: number) => void;
};

const Toolbar = ({
  folderName,
  sortOption,
  setSortOption,
  explorerOpen,
  onToggleExplorer,
  activeFolderLabel,
  activeFolderPathOnDisk,
  canOpenFolderPath = false,
  onOpenFolderPath,
  rowHeight,
  setRowHeight,
}: ToolbarProps) => {
  const [isSortMenuOpen, setIsSortMenuOpen] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const sortMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    const checkMaximized = async () => {
      try {
        const maximized = await appWindow.isMaximized();
        setIsMaximized(maximized);
      } catch (e) {
        console.error('Failed to check maximized state', e);
      }
    };
    checkMaximized();
    const unlisten = appWindow.onResized(() => checkMaximized());
    return () => {
      unlisten.then((f: () => void) => f());
    };
  }, []);

  const handleMinimize = async () => {
    await getCurrentWindow().minimize();
  };

  const handleToggleMaximize = async () => {
    await getCurrentWindow().toggleMaximize();
    setIsMaximized(!isMaximized);
  };

  const handleClose = async () => {
    await getCurrentWindow().close();
  };

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
  const sliderFillPercent = useMemo(() => {
    const clamped = snapRowHeight(Number(rowHeight) || MIN_ROW_HEIGHT);
    return (
      ((clamped - MIN_ROW_HEIGHT) / (MAX_ROW_HEIGHT - MIN_ROW_HEIGHT)) * 100
    );
  }, [rowHeight]);
  const snappedRowHeight = useMemo(
    () => snapRowHeight(Number(rowHeight) || MIN_ROW_HEIGHT),
    [rowHeight],
  );

  useEffect(() => {
    if (!isSortMenuOpen) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      if (!sortMenuRef.current) return;
      if (sortMenuRef.current.contains(event.target as Node)) return;
      setIsSortMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
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
    <header
      data-tauri-drag-region
      className="toolbar"
      onPointerDown={(e) => {
        // Only drag if left clicking directly on the header background/safe areas,
        // not on inputs, buttons, or scrollbars.
        if (e.button === 0 && (e.target as HTMLElement).tagName !== 'BUTTON' && (e.target as HTMLElement).tagName !== 'INPUT') {
          getCurrentWindow().startDragging();
        }
      }}
    >
      <div data-tauri-drag-region className="toolbar-section toolbar-meta">
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
        <button
          type="button"
          className="toolbar-folder-path-btn"
          title={
            canOpenFolderPath && activeFolderPathOnDisk
              ? `Open in file explorer: ${activeFolderPathOnDisk}`
              : folderPathRaw
          }
          onClick={() => onOpenFolderPath?.()}
          disabled={!canOpenFolderPath}
        >
          <span className="toolbar-folder-path">{folderPathLabel}</span>
        </button>
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
            min={MIN_ROW_HEIGHT}
            max={MAX_ROW_HEIGHT}
            step={ROW_HEIGHT_STEP}
            value={snappedRowHeight}
            onChange={(e) => setRowHeight(snapRowHeight(Number(e.target.value)))}
            style={
              {
                '--toolbar-slider-fill': `${sliderFillPercent}%`,
              } as React.CSSProperties
            }
          />
          <MaximizeIcon size={14} className="toolbar-dim" />
        </div>
      </div>

      <div className="toolbar-section toolbar-actions">
        {/* Standard Window Controls */}
        <div className="toolbar-window-controls">
          <button
            className="toolbar-window-btn"
            onClick={handleMinimize}
            type="button"
            aria-label="Minimize"
          >
            <Minus size={16} />
          </button>
          <button
            className="toolbar-window-btn"
            onClick={handleToggleMaximize}
            type="button"
            aria-label="Maximize"
          >
            <Square size={13} />
          </button>
          <button
            className="toolbar-window-btn toolbar-btn-close-action"
            onClick={handleClose}
            type="button"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
      </div>
    </header>
  );
};

export default Toolbar;
