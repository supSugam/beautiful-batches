import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  FolderOpen,
  ArrowUpDown,
  Clock3,
  Type,
  Scale,
  Shuffle,
  Eye,
  Check,
  ChevronDown,
  Grid3x3,
  Maximize as MaximizeIcon,
  Download,
  Settings,
  X,
  Minus,
  Square,
  RefreshCw,
  Filter,
  SortAsc,
  SortDesc,
  LayoutGrid,
  Crop,
  RotateCw,
  Wand2,
  Layers,
} from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import useStore from '../../store/useStore';
import type { LucideIcon } from 'lucide-react';
import type { ImageFilterType, InspectorMode, SortOption, SortOrder } from '../../types/app';
import './Toolbar.css';

const MIN_ROW_HEIGHT = 150;
const MAX_ROW_HEIGHT = 500;
const ROW_HEIGHT_STEP = 70;
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
    label: 'Last Modified',
    Icon: Clock3,
  },
  {
    value: 'name',
    label: 'Alphabetical',
    Icon: Type,
  },
  {
    value: 'size',
    label: 'File Size',
    Icon: Scale,
  },
  {
    value: 'aspect_ratio',
    label: 'Aspect Ratio',
    Icon: Grid3x3,
  },
  {
    value: 'shuffle',
    label: 'Shuffle',
    Icon: Shuffle,
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
  sortOrder: SortOrder;
  setSortOption: (option: SortOption) => void;
  setSortOrder: (order: SortOrder) => void;
  explorerOpen: boolean;
  onToggleExplorer: () => void;
  activeFolderLabel: string;
  activeFolderPathOnDisk?: string;
  canOpenFolderPath?: boolean;
  onOpenFolderPath?: () => void;
  rowHeight: number;
  setRowHeight: (value: number) => void;
  onOpenExportPlan: () => void;
  onOpenWatermarkSettings: () => void;
  inspectorMode: InspectorMode;
  onSetInspectorMode: (mode: InspectorMode) => void;
  showExcluded: boolean;
  setShowExcluded: (value: boolean) => void;
  consideredCount: number;
  totalCount: number;
  activeFilters: Set<ImageFilterType>;
  toggleFilter: (filter: ImageFilterType) => void;
  clearFilters: () => void;
  onRefreshFolder?: () => void;
};

const Toolbar = ({
  folderName,
  sortOption,
  sortOrder,
  setSortOption,
  setSortOrder,
  explorerOpen,
  onToggleExplorer,
  activeFolderLabel,
  activeFolderPathOnDisk,
  canOpenFolderPath = false,
  onOpenFolderPath,
  rowHeight,
  setRowHeight,
  onOpenExportPlan,
  onOpenWatermarkSettings,
  inspectorMode,
  onSetInspectorMode,
  showExcluded,
  setShowExcluded,
  consideredCount,
  totalCount,
  activeFilters,
  toggleFilter,
  clearFilters,
  onRefreshFolder,
}: ToolbarProps) => {
  const [isViewMenuOpen, setIsViewMenuOpen] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const viewMenuRef = useRef<HTMLDivElement | null>(null);

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

  // Local state for smooth slider dragging without triggering layout too early
  const [localRowHeight, setLocalRowHeight] = useState(snappedRowHeight);

  // Sync local state if external rowHeight changes
  useEffect(() => {
    setLocalRowHeight(snappedRowHeight);
  }, [snappedRowHeight]);

  const localSliderFillPercent = useMemo(() => {
    return (
      ((localRowHeight - MIN_ROW_HEIGHT) / (MAX_ROW_HEIGHT - MIN_ROW_HEIGHT)) * 100
    );
  }, [localRowHeight]);

  // Precise math to ensure the rounded fill bar always encapsulates the 12px thumb perfectly.
  // The fill should extend from the left edge to the far edge of the thumb circle.
  const fillWidthStyle = useMemo(() => {
    // 6px (start radius) + (remaining track space) * percent
    return `calc(12px + (100% - 12px) * ${localSliderFillPercent / 100})`;
  }, [localSliderFillPercent]);

  useEffect(() => {
    if (!isViewMenuOpen) return undefined;

    const handlePointerDown = (event: PointerEvent) => {
      if (!viewMenuRef.current) return;
      if (viewMenuRef.current.contains(event.target as Node)) return;
      setIsViewMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsViewMenuOpen(false);
      }
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isViewMenuOpen]);

  const processingState = useStore((state) => state.processingState);
  const setProcessingState = useStore((state) => state.setProcessingState);
  const openSettings = useStore((state) => state.openSettings);

  return (
    <header
      data-tauri-drag-region
      className="toolbar"
    >
      <div data-tauri-drag-region className="toolbar-section toolbar-meta">
        <button
          className={`toolbar-logo-toggle ${explorerOpen ? 'is-active' : ''}`}
          onClick={onToggleExplorer}
          title="Toggle folders sidebar (Ctrl/Cmd + B)"
          type="button"
          aria-label="Toggle folders sidebar"
          aria-pressed={explorerOpen}
        >
          <img
            src="/apple-touch-icon.png"
            alt=""
            className="toolbar-app-logo"
            draggable={false}
          />
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

        {onRefreshFolder && (
          <button
            type="button"
            className="toolbar-refresh-btn"
            title="Refresh folder contents"
            onClick={onRefreshFolder}
          >
            <RefreshCw size={13} className="toolbar-dim" />
          </button>
        )}

        <div className="toolbar-folder-stats" title={`${consideredCount} images included / ${totalCount} total images in this view`}>
          <span className="stats-considered">{consideredCount}</span>
          <span className="stats-divider">/</span>
          <span className="stats-total">{totalCount}</span>
        </div>
      </div>

      <div className="toolbar-section toolbar-controls">
        <div
          className={`toolbar-view-wrap ${isViewMenuOpen ? 'is-open' : ''}`}
          ref={viewMenuRef}
        >
          <div className="toolbar-combined-trigger-group">
            <button
              type="button"
              className="toolbar-view-trigger"
              onClick={() => setIsViewMenuOpen((prev) => !prev)}
              onPointerDown={(e) => e.stopPropagation()}
              title="View and sorting options"
            >
              <LayoutGrid size={14} className="toolbar-dim" />
              <div className="toolbar-view-trigger-label">
                <span className="view-trigger-prefix">View:</span>
                <span className="view-trigger-value">{activeSortOption.label}</span>
              </div>
              <ChevronDown size={14} className="toolbar-sort-chevron" />
            </button>

            <button
              type="button"
              className="toolbar-sort-order-toggle"
              onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
              onPointerDown={(e) => e.stopPropagation()}
              title={`Toggle sort order: ${sortOrder === 'asc' ? 'Ascending' : 'Descending'}`}
            >
              {sortOrder === 'asc' ? (
                <SortAsc size={14} />
              ) : (
                <SortDesc size={14} />
              )}
            </button>
            <button
              type="button"
              className={`toolbar-view-toggle-btn ${activeFilters.size > 0 || showExcluded ? 'is-active' : ''}`}
              onClick={() => setIsViewMenuOpen((prev) => !prev)}
              onPointerDown={(e) => e.stopPropagation()}
              title="Filter images"
            >
              <Filter
                size={14}
                className={activeFilters.size > 0 || showExcluded ? 'text-primary' : ''}
              />
              {activeFilters.size > 0 && (
                <span className="filter-count-badge">{activeFilters.size}</span>
              )}
            </button>
          </div>

          {isViewMenuOpen && (
            <div className="premium-context-menu toolbar-view-menu" role="menu">
              <div className="menu-header">Sort By</div>
              {SORT_OPTIONS.map((option) => {
                const isActive = option.value === sortOption;
                const IconComponent = option.Icon;
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={isActive}
                    className={`menu-item ${isActive ? 'is-active' : ''}`}
                    onClick={() => {
                      setSortOption(option.value);
                      setIsViewMenuOpen(false);
                    }}
                  >
                    <IconComponent
                      size={14}
                      className={`menu-icon ${isActive ? 'text-primary' : ''}`}
                    />
                    <div className="menu-text">
                      <span className="menu-label">{option.label}</span>
                    </div>
                    {isActive && <Check size={14} className="menu-check" />}
                  </button>
                );
              })}

              <div className="menu-divider" />
              <div className="menu-header">Filters</div>
              <button
                type="button"
                role="menuitemcheckbox"
                aria-checked={showExcluded}
                className={`menu-item ${showExcluded ? 'is-active' : ''}`}
                onClick={() => setShowExcluded(!showExcluded)}
              >
                <LayoutGrid
                  size={14}
                  className={`menu-icon ${showExcluded ? 'text-primary' : ''}`}
                />
                <div className="menu-text">
                  <span className="menu-label">Show Excluded</span>
                </div>
                {showExcluded && <Check size={14} className="menu-check" />}
              </button>
              <div className="menu-divider" />
              <div className="menu-subheader">Content Edits</div>
              {[
                { value: 'cropped', label: 'Cropped', Icon: Crop },
                { value: 'transformed', label: 'Transformed', Icon: RotateCw },
                { value: 'has_caption', label: 'Has Caption', Icon: Type },
                { value: 'has_ai_edits', label: 'AI Edits', Icon: Wand2 },
                { value: 'has_tweaks', label: 'UI Tweaks', Icon: Layers },
                { value: 'has_resize', label: 'Export Resize', Icon: MaximizeIcon },
              ].map((filter) => {
                const isActive = activeFilters.has(filter.value as ImageFilterType);
                const IconComponent = filter.Icon;
                return (
                  <button
                    key={filter.value}
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={isActive}
                    className={`menu-item ${isActive ? 'is-active' : ''}`}
                    onClick={() => toggleFilter(filter.value as ImageFilterType)}
                  >
                    <IconComponent
                      size={14}
                      className={`menu-icon ${isActive ? 'text-primary' : ''}`}
                    />
                    <div className="menu-text">
                      <span className="menu-label">{filter.label}</span>
                    </div>
                    {isActive && <Check size={14} className="menu-check" />}
                  </button>
                );
              })}
              {activeFilters.size > 0 && (
                <>
                  <div className="menu-divider" />
                  <button
                    type="button"
                    className="menu-item menu-item-danger"
                    onClick={() => {
                      clearFilters();
                      setIsViewMenuOpen(false);
                    }}
                  >
                    <X size={14} className="menu-icon" />
                    <div className="menu-text">
                      <span className="menu-label">Clear All Filters</span>
                    </div>
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        <div className="toolbar-combined-trigger-group">
          <button
            type="button"
            className={`toolbar-view-toggle-btn ${inspectorMode === 'view' ? 'is-active' : ''}`}
            onClick={() =>
              onSetInspectorMode(inspectorMode === 'edit' ? 'view' : 'edit')
            }
            onPointerDown={(e) => e.stopPropagation()}
            title={
              inspectorMode === 'edit'
                ? 'Switch to View Mode'
                : 'Switch to Edit Mode'
            }
          >
            <Eye
              size={14}
              className={inspectorMode === 'view' ? 'text-primary' : ''}
            />
          </button>

          <button
            type="button"
            className="toolbar-view-toggle-btn"
            onClick={() => {
              onOpenWatermarkSettings();
              setIsViewMenuOpen(false);
            }}
            onPointerDown={(e) => e.stopPropagation()}
            title="Watermark & AI Settings"
          >
            <Settings size={14} />
          </button>
        </div>


        <div className="control-group">
          <Grid3x3 size={13} className="toolbar-dim" />
          <div className="size-slider-container">
            <div className="size-slider-track" />
            <div 
              className="size-slider-fill" 
              style={{ width: fillWidthStyle }} 
            />
            <input
              type="range"
              className="size-slider"
              min={MIN_ROW_HEIGHT}
              max={MAX_ROW_HEIGHT}
              step={ROW_HEIGHT_STEP}
              value={localRowHeight}
              onChange={(e) => setLocalRowHeight(snapRowHeight(Number(e.target.value)))}
              onPointerUp={() => setRowHeight(localRowHeight)}
            />
          </div>
          <MaximizeIcon size={14} className="toolbar-dim" />
        </div>
      </div>

      <div className="toolbar-section toolbar-actions">
        {processingState.isActive && (
          <button
            type="button"
            className="toolbar-processing-indicator"
            onClick={() => setProcessingState({ isMinimized: false })}
            title="Show processing HUD"
            aria-label="Show processing HUD"
          >
            <RefreshCw size={14} className="indicator-pulse" />
          </button>
        )}

        <button
          type="button"
          className="toolbar-export-btn"
          onClick={onOpenExportPlan}
          title="Open export plan"
        >
          <Download size={14} />
          <span>Export</span>
        </button>

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
