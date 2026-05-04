import React, { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { Command } from 'cmdk';
import {
  Search,
  Settings,
  X,
  Command as CommandIcon,
  Filter,
  Trash2,
  Undo2,
  Image as ImageIcon,
  FolderOpen,
  ArrowRight,
  Maximize2,
  Wand2,
  Check,
  Replace,
  Type,
} from 'lucide-react';
import useStore from '../store/useStore';
import SegmentedControl from './common/SegmentedControl';
import './CommandPalette.css';

const CommandPalette = () => {
  const isOpen = useStore((state) => state.isCommandPaletteOpen);
  const setIsOpen = useStore((state) => state.setIsCommandPaletteOpen);
  const images = useStore((state) => state.images);
  const selectedId = useStore((state) => state.selectedId);
  const setSelectedId = useStore((state) => state.setSelectedId);
  const clearFilters = useStore((state) => state.clearFilters);
  const showExcluded = useStore((state) => state.showExcluded);
  const setShowExcluded = useStore((state) => state.setShowExcluded);
  const findAndReplaceCaptions = useStore((state) => state.findAndReplaceCaptions);
  const openSettings = useStore((state) => state.openSettings);
  const captionById = useStore((state) => state.captionById);
  
  const [search, setSearch] = useState('');
  const [subMode, setSubMode] = useState<'main' | 'find-replace'>('main');
  const [findText, setFindText] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [replaceScope, setReplaceScope] = useState<'all' | 'current'>('all');

  const matchCount = useMemo(() => {
    if (!findText) return 0;
    const scopeImages =
      replaceScope === 'current'
        ? images.filter((img) => img.id === selectedId)
        : images;

    let count = 0;
    const escapedFind = findText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(escapedFind, 'g');

    scopeImages.forEach((image) => {
      const caption = captionById.get(image.id) || '';
      const matches = caption.match(regex);
      if (matches) count += matches.length;
    });
    return count;
  }, [findText, replaceScope, images, selectedId, captionById]);

  const inputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcut Ctrl+K / Cmd+K
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setIsOpen(!isOpen);
      }
    };

    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, [isOpen, setIsOpen]);

  // Reset state when closing
  useEffect(() => {
    if (!isOpen) {
      setSearch('');
      setSubMode('main');
      setFindText('');
      setReplaceText('');
    } else {
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [isOpen]);

  const handleSelectImage = useCallback((id: string) => {
    setSelectedId(id);
    setIsOpen(false);
  }, [setSelectedId, setIsOpen]);

  const handleExecuteReplace = () => {
    if (!findText) return;
    findAndReplaceCaptions(findText, replaceText, replaceScope);
    setIsOpen(false);
  };

  return (
    <Command.Dialog
      open={isOpen}
      onOpenChange={setIsOpen}
      label="Command Palette"
      className="command-palette-overlay"
    >
      <div className="command-palette-content">
        <div className="command-palette-input-wrapper">
          <Search size={18} className="command-palette-search-icon" />
          <Command.Input
            ref={inputRef}
            placeholder={subMode === 'main' ? "Type a command or search images..." : "Find and replace captions..."}
            value={search}
            onValueChange={setSearch}
            className="command-palette-input"
          />
          <kbd className="command-palette-esc">ESC</kbd>
        </div>

        <Command.List className="command-palette-list">
          <Command.Empty className="command-palette-empty">No results found.</Command.Empty>

          {subMode === 'main' && (
            <>
              <Command.Group heading="Actions" className="command-palette-group">
                <Command.Item
                  onSelect={() => setSubMode('find-replace')}
                  className="command-palette-item"
                >
                  <Replace size={16} />
                  <span>Find and Replace Captions...</span>
                  <kbd>FnR</kbd>
                </Command.Item>
                <Command.Item
                  onSelect={() => { clearFilters(); setIsOpen(false); }}
                  className="command-palette-item"
                >
                  <Filter size={16} />
                  <span>Clear All Filters</span>
                </Command.Item>
                <Command.Item
                  onSelect={() => { setShowExcluded(!showExcluded); setIsOpen(false); }}
                  className="command-palette-item"
                >
                  <Maximize2 size={16} />
                  <span>Toggle Show Excluded</span>
                </Command.Item>
                <Command.Item
                  onSelect={() => { openSettings(); setIsOpen(false); }}
                  className="command-palette-item"
                >
                  <Settings size={16} />
                  <span>Open Settings</span>
                </Command.Item>
              </Command.Group>

              <Command.Group heading="Images" className="command-palette-group">
                {images.slice(0, 50).map((image) => (
                  <Command.Item
                    key={image.id}
                    onSelect={() => handleSelectImage(image.id)}
                    className="command-palette-item image-item"
                  >
                    <ImageIcon size={16} />
                    <div className="image-item-meta">
                      <span className="image-item-name">{image.name}</span>
                      <span className="image-item-path">{image.relativePath}</span>
                    </div>
                  </Command.Item>
                ))}
              </Command.Group>
            </>
          )}

          {subMode === 'find-replace' && (
            <div className="find-replace-form">
              <div className="form-header">
                <button onClick={() => setSubMode('main')} className="back-btn">
                  <Undo2 size={16} /> Back
                </button>
                <h3>Find and Replace</h3>
              </div>
              
              <div className="form-fields">
                <div className="field-group">
                  <div className="field-header">
                    <label>Find Text</label>
                    {findText && (
                      <span className={`match-count ${matchCount > 0 ? 'has-matches' : 'no-matches'}`}>
                        {matchCount} {matchCount === 1 ? 'match' : 'matches'}
                      </span>
                    )}
                  </div>
                  <input
                    autoFocus
                    type="text"
                    value={findText}
                    onChange={(e) => setFindText(e.target.value)}
                    placeholder="String to search for..."
                    className="form-input"
                  />
                </div>
                <div className="field-group">
                  <label>Replace With</label>
                  <input
                    type="text"
                    value={replaceText}
                    onChange={(e) => setReplaceText(e.target.value)}
                    placeholder="String to replace with..."
                    className="form-input"
                  />
                </div>

                <div className="field-group">
                  <label>Scope</label>
                  <SegmentedControl<'all' | 'current'>
                    value={replaceScope}
                    onChange={setReplaceScope}
                    options={[
                      { value: 'current', label: 'Current Image', disabled: !selectedId },
                      { value: 'all', label: 'All Images' },
                    ]}
                    ariaLabel="Selection scope"
                    equalWidth
                  />
                </div>

                <button
                  className="execute-btn premium-btn"
                  onClick={handleExecuteReplace}
                  disabled={!findText || matchCount === 0}
                >
                  <Check size={16} /> Apply to {matchCount} {matchCount === 1 ? 'occurrence' : 'occurrences'}
                </button>
              </div>
            </div>
          )}
        </Command.List>
        
        <div className="command-palette-footer">
          <div className="footer-item">
            <kbd>↵</kbd> Select
          </div>
          <div className="footer-item">
            <kbd>↑↓</kbd> Navigate
          </div>
          <div className="footer-item">
            <kbd>ESC</kbd> Close
          </div>
        </div>
      </div>
    </Command.Dialog>
  );
};

export default CommandPalette;
