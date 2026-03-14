import React, { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Search } from 'lucide-react';
import type { GalleryImage } from '../../../types/app';

type InspectorMetadataViewProps = {
  image: GalleryImage;
};

type MetadataItem = {
  id: string;
  section: string;
  label: string;
  value: string;
  searchText: string;
  multiline?: boolean;
};

type EmbeddedMetadataEntry = {
  id: string;
  key: string;
  value: string;
  source: string;
  preview: string;
  formattedValue: string;
  isJson: boolean;
  lineCount: number;
  searchText: string;
  jsonValues: JsonValueEntry[];
};

type EmbeddedMetadataPayloadEntry = {
  key?: string;
  value?: string;
  source?: string;
};

type JsonValueEntry = {
  path: string;
  value: string;
};

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const formatDateTime = (timestamp: number): string => {
  const safeTimestamp = Number(timestamp || 0) || 0;
  if (safeTimestamp <= 0) return 'Unavailable';
  const date = new Date(safeTimestamp);
  if (Number.isNaN(date.getTime())) return 'Unavailable';

  const day = String(date.getDate()).padStart(2, '0');
  const month = MONTHS[date.getMonth()] || '';
  const year = date.getFullYear();
  const rawHours = date.getHours();
  const hours12 = rawHours % 12 || 12;
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const meridiem = rawHours >= 12 ? 'PM' : 'AM';
  return `${day} ${month} ${year} ${String(hours12).padStart(2, '0')}:${minutes}:${seconds} ${meridiem}`;
};

const formatBytes = (bytes: number): string => {
  const safeBytes = Math.max(0, Number(bytes || 0) || 0);
  if (safeBytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const unitIndex = Math.min(
    Math.floor(Math.log(safeBytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = safeBytes / 1024 ** unitIndex;
  const precision = value >= 10 || unitIndex === 0 ? 0 : 2;
  return `${value.toFixed(precision)} ${units[unitIndex]} (${safeBytes.toLocaleString()} bytes)`;
};

const normalizePath = (value: unknown): string =>
  String(value || '').replace(/\\/g, '/');

const getFileExtension = (filename: string): string => {
  const dotIndex = filename.lastIndexOf('.');
  if (dotIndex <= 0 || dotIndex === filename.length - 1) return '';
  return filename.slice(dotIndex + 1).toLowerCase();
};

const normalizeWhitespacePreview = (value: string, maxLength = 180): string => {
  const compact = String(value || '').replace(/\s+/g, ' ').trim();
  if (compact.length <= maxLength) return compact || 'Empty value';
  return `${compact.slice(0, maxLength)}...`;
};

const formatEmbeddedValue = (
  rawValue: string,
): { formattedValue: string; isJson: boolean } => {
  const text = String(rawValue || '');
  const trimmed = text.trim();
  if (!trimmed) {
    return { formattedValue: '', isJson: false };
  }

  const likelyJson =
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'));
  if (!likelyJson) {
    return { formattedValue: text, isJson: false };
  }

  try {
    const parsed = JSON.parse(trimmed);
    return {
      formattedValue: JSON.stringify(parsed, null, 2),
      isJson: true,
    };
  } catch {
    return { formattedValue: text, isJson: false };
  }
};

const stringifyJsonLeaf = (value: unknown): string => {
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const flattenJsonValues = (
  value: unknown,
  path: string,
  collector: JsonValueEntry[],
): void => {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    collector.push({
      path: path || '$',
      value: stringifyJsonLeaf(value),
    });
    return;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      collector.push({ path: path || '$', value: '[]' });
      return;
    }
    value.forEach((child, index) => {
      flattenJsonValues(child, `${path}[${index}]`, collector);
    });
    return;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) {
      collector.push({ path: path || '$', value: '{}' });
      return;
    }
    entries.forEach(([key, child]) => {
      const childPath = path ? `${path}.${key}` : key;
      flattenJsonValues(child, childPath, collector);
    });
    return;
  }

  collector.push({
    path: path || '$',
    value: stringifyJsonLeaf(value),
  });
};

const extractJsonValues = (rawValue: string): JsonValueEntry[] => {
  const trimmed = String(rawValue || '').trim();
  if (!trimmed) return [];
  try {
    const parsed = JSON.parse(trimmed);
    const collector: JsonValueEntry[] = [];
    flattenJsonValues(parsed, '', collector);
    return collector;
  } catch {
    return [];
  }
};

const toMetadataItems = (image: GalleryImage): MetadataItem[] => {
  const normalizedAbsolutePath = normalizePath(image.absolutePath);
  const normalizedRelativePath = normalizePath(image.relativePath);
  const fullPath = normalizedAbsolutePath || normalizedRelativePath || image.name;
  const extension = getFileExtension(image.name);
  const format = extension ? extension.toUpperCase() : 'Unknown';
  const mimeType = String(image?.file?.type || '').trim() || 'Unknown';
  const aspectRatio = image.naturalHeight > 0
    ? (image.naturalWidth / image.naturalHeight).toFixed(4)
    : 'Unknown';

  const buildItem = (
    id: string,
    section: string,
    label: string,
    value: string,
    options: { multiline?: boolean } = {},
  ): MetadataItem => ({
    id,
    section,
    label,
    value,
    searchText: `${section} ${label} ${String(value || '').slice(0, 2048)}`.toLowerCase(),
    multiline: options.multiline || false,
  });

  return [
    buildItem('full-path', 'File', 'Full Path', fullPath, { multiline: true }),
    buildItem(
      'relative-path',
      'File',
      'Relative Path',
      normalizedRelativePath || 'Unavailable',
      { multiline: true },
    ),
    buildItem('file-name', 'File', 'File Name', image.name),
    buildItem('format', 'Image Properties', 'Format', format),
    buildItem(
      'width',
      'Image Properties',
      'Width',
      `${Math.max(1, Math.round(image.naturalWidth))} px`,
    ),
    buildItem(
      'height',
      'Image Properties',
      'Height',
      `${Math.max(1, Math.round(image.naturalHeight))} px`,
    ),
    buildItem(
      'resolution',
      'Image Properties',
      'Resolution',
      `${Math.max(1, Math.round(image.naturalWidth))} x ${Math.max(1, Math.round(image.naturalHeight))}`,
    ),
    buildItem('aspect-ratio', 'Image Properties', 'Aspect Ratio', aspectRatio),
    buildItem('mime-type', 'File', 'MIME Type', mimeType),
    buildItem('file-size', 'File', 'File Size', formatBytes(image.sourceSize)),
    buildItem(
      'accessed-at',
      'Dates',
      'Last Accessed',
      formatDateTime(image.sourceAccessedAt),
    ),
    buildItem(
      'created-at',
      'Dates',
      'Created',
      formatDateTime(image.sourceCreatedAt),
    ),
    buildItem(
      'last-modified',
      'Dates',
      'Last Modified',
      formatDateTime(image.sourceLastModified),
    ),
    buildItem('loaded-at', 'Dates', 'Loaded In App', formatDateTime(image.loadedAt)),
  ];
};

const InspectorMetadataView = ({ image }: InspectorMetadataViewProps) => {
  const [query, setQuery] = useState('');
  const [embeddedMetadata, setEmbeddedMetadata] = useState<EmbeddedMetadataEntry[]>([]);
  const [copiedEmbeddedId, setCopiedEmbeddedId] = useState<string | null>(null);
  const previewHostRef = useRef<HTMLDivElement | null>(null);
  const copyFeedbackTimerRef = useRef<number>(0);
  const [previewSize, setPreviewSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const normalizedQuery = query.trim().toLowerCase();
  const imageRatio = useMemo(
    () =>
      Math.max(
        0.01,
        Number(image.naturalWidth || 1) / Math.max(1, Number(image.naturalHeight || 1)),
      ),
    [image.naturalHeight, image.naturalWidth],
  );

  const metadataItems = useMemo(() => toMetadataItems(image), [image]);
  const filteredBaseItems = useMemo(
    () =>
      normalizedQuery
        ? metadataItems.filter((item) => item.searchText.includes(normalizedQuery))
        : metadataItems,
    [metadataItems, normalizedQuery],
  );
  const filteredEmbeddedItems = useMemo(
    () =>
      normalizedQuery
        ? embeddedMetadata.filter((item) => item.searchText.includes(normalizedQuery))
        : embeddedMetadata,
    [embeddedMetadata, normalizedQuery],
  );
  const totalItemsCount = metadataItems.length + embeddedMetadata.length;
  const visibleItemsCount = filteredBaseItems.length + filteredEmbeddedItems.length;

  const groupedItems = useMemo(() => {
    const sections = ['Image Properties', 'File', 'Dates'];
    const bySection = new Map<string, MetadataItem[]>();

    sections.forEach((section) => bySection.set(section, []));
    filteredBaseItems.forEach((item) => {
      if (!bySection.has(item.section)) {
        bySection.set(item.section, []);
      }
      bySection.get(item.section)?.push(item);
    });

    return sections
      .map((section) => ({
        section,
        items: bySection.get(section) || [],
      }))
      .filter((group) => group.items.length > 0);
  }, [filteredBaseItems]);

  useEffect(() => {
    let cancelled = false;
    const normalizedPath = String(image?.absolutePath || '').trim();

    if (
      !normalizedPath ||
      typeof window === 'undefined' ||
      !('__TAURI_INTERNALS__' in window)
    ) {
      setEmbeddedMetadata([]);
      return undefined;
    }

    const load = async () => {
      try {
        const result = await invoke<{ entries?: EmbeddedMetadataPayloadEntry[] }>(
          'read_image_embedded_metadata',
          { imagePath: normalizedPath },
        );
        if (cancelled) return;
        const entries = Array.isArray(result?.entries) ? result.entries : [];
        setEmbeddedMetadata(
          entries
            .filter((entry) => String(entry?.key || '').trim().length > 0)
            .map((entry, index) => {
              const key = String(entry.key || '').trim();
              const value = String(entry.value || '');
              const source = String(entry.source || 'embedded').trim();
              const { formattedValue, isJson } = formatEmbeddedValue(value);
              const safeFormattedValue = formattedValue || value || '';
              const jsonValues = isJson ? extractJsonValues(value) : [];
              const lineCount = Math.max(
                1,
                safeFormattedValue.split('\n').length,
              );
              return {
                id: `embedded-${index}-${key}`,
                key,
                value,
                source,
                preview: normalizeWhitespacePreview(safeFormattedValue),
                formattedValue: safeFormattedValue,
                isJson,
                lineCount,
                searchText: `${key} ${source} ${value.slice(0, 4096)}`.toLowerCase(),
                jsonValues,
              };
            }),
        );
      } catch {
        if (!cancelled) {
          setEmbeddedMetadata([]);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, [image?.absolutePath]);

  useEffect(() => {
    setCopiedEmbeddedId(null);
  }, [image?.id]);

  useEffect(() => {
    const host = previewHostRef.current;
    if (!host) return undefined;

    const computeSize = (hostWidth: number, hostHeight: number) => {
      const safeHostWidth = Math.max(0, Math.floor(hostWidth));
      if (safeHostWidth <= 0) {
        setPreviewSize({ width: 0, height: 0 });
        return;
      }
      const safeHostHeight = Math.max(0, Math.floor(hostHeight));

      const viewportHeight =
        typeof window !== 'undefined' ? Math.max(1, window.innerHeight || 1) : 900;
      const maxHeight = Math.min(
        780,
        Math.round(viewportHeight * 0.68),
        safeHostHeight > 0 ? safeHostHeight : Number.POSITIVE_INFINITY,
      );
      const minHeight = Math.min(220, maxHeight);

      let nextHeight = safeHostWidth / imageRatio;
      nextHeight = Math.max(minHeight, Math.min(maxHeight, nextHeight));
      let nextWidth = nextHeight * imageRatio;

      if (nextWidth > safeHostWidth) {
        nextWidth = safeHostWidth;
        nextHeight = nextWidth / imageRatio;
      }

      setPreviewSize({
        width: Math.max(1, Math.round(nextWidth)),
        height: Math.max(1, Math.round(nextHeight)),
      });
    };

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      computeSize(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(host);

    const rect = host.getBoundingClientRect();
    computeSize(rect.width, rect.height);

    return () => observer.disconnect();
  }, [imageRatio]);

  useEffect(() => {
    return () => {
      if (copyFeedbackTimerRef.current) {
        window.clearTimeout(copyFeedbackTimerRef.current);
      }
    };
  }, []);

  const handleCopyEmbeddedValue = async (entryId: string, value: string) => {
    const text = String(value || '');
    if (!text) return;

    let copied = false;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        copied = true;
      }
    } catch {
      copied = false;
    }

    if (!copied && typeof document !== 'undefined') {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.setAttribute('readonly', 'true');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      textarea.style.pointerEvents = 'none';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        copied = document.execCommand('copy');
      } catch {
        copied = false;
      } finally {
        document.body.removeChild(textarea);
      }
    }

    if (!copied) return;
    setCopiedEmbeddedId(entryId);
    if (copyFeedbackTimerRef.current) {
      window.clearTimeout(copyFeedbackTimerRef.current);
    }
    copyFeedbackTimerRef.current = window.setTimeout(() => {
      setCopiedEmbeddedId(null);
      copyFeedbackTimerRef.current = 0;
    }, 1100);
  };

  return (
    <div className="inspector-view-layout">
      <section className="inspector-view-preview-card">
        <div ref={previewHostRef} className="inspector-view-preview-host">
          <div
            className="inspector-view-preview-shell"
            style={
              previewSize.width > 0 && previewSize.height > 0
                ? {
                    width: `${previewSize.width}px`,
                    height: `${previewSize.height}px`,
                  }
                : undefined
            }
          >
            <img
              src={image.objectUrl}
              alt={image.name}
              className="inspector-view-preview-image"
              draggable={false}
            />
          </div>
        </div>
      </section>

      <section className="inspector-view-meta-card">
        <div className="inspector-view-meta-head">
          <h3>Metadata</h3>
          <span>
            {visibleItemsCount}/{totalItemsCount}
          </span>
        </div>

        <label className="inspector-meta-search-field">
          <Search size={14} className="inspector-meta-search-icon" />
          <input
            type="text"
            className="inspector-meta-search-input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search metadata..."
            spellCheck={false}
          />
        </label>

        {groupedItems.length === 0 && filteredEmbeddedItems.length === 0 ? (
          <div className="inspector-view-meta-empty">
            No metadata matches &quot;{query}&quot;.
          </div>
        ) : (
          <div className="inspector-view-meta-groups">
            {groupedItems.map((group) => (
              <section key={group.section} className="inspector-view-meta-group">
                <h4>{group.section}</h4>
                <dl className="inspector-view-meta-list">
                  {group.items.map((item) => (
                    <div
                      key={item.id}
                      className={`inspector-view-meta-row ${item.multiline ? 'is-multiline' : ''}`}
                    >
                      <dt>{item.label}</dt>
                      <dd
                        className={`${item.id.includes('path') ? 'is-path-value' : ''} ${item.multiline ? 'is-multiline' : ''}`.trim()}
                        title={item.value}
                      >
                        {item.value}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}

            <section className="inspector-view-meta-group inspector-view-meta-group--embedded">
              <div className="inspector-view-meta-group-head">
                <h4>Embedded Metadata</h4>
                <span className="inspector-embedded-count">
                  {filteredEmbeddedItems.length}/{embeddedMetadata.length}
                </span>
              </div>

              {embeddedMetadata.length === 0 ? (
                <p className="inspector-embedded-empty">
                  No embedded metadata found in this image.
                </p>
              ) : filteredEmbeddedItems.length === 0 ? (
                <p className="inspector-embedded-empty">
                  No embedded metadata matches &quot;{query}&quot;.
                </p>
              ) : (
                <div className="inspector-embedded-list">
                  {filteredEmbeddedItems.map((entry) => {
                    const isCopied = copiedEmbeddedId === entry.id;
                    return (
                      <article key={entry.id} className="inspector-embedded-item">
                        <div className="inspector-embedded-summary">
                          <span className="inspector-embedded-key">{entry.key}</span>
                          <span className="inspector-embedded-source">{entry.source}</span>
                          <span className="inspector-embedded-lines">
                            {entry.isJson ? 'JSON' : 'Text'} | {entry.lineCount} lines
                          </span>
                        </div>

                        <p className="inspector-embedded-preview">{entry.preview}</p>

                        {entry.isJson && entry.jsonValues.length > 0 ? (
                          <div className="inspector-embedded-json-values">
                            {entry.jsonValues.map((jsonEntry) => {
                              const copyId = `${entry.id}:${jsonEntry.path}`;
                              const isValueCopied = copiedEmbeddedId === copyId;
                              return (
                                <button
                                  key={copyId}
                                  type="button"
                                  className={`inspector-embedded-json-row ${isValueCopied ? 'is-copied' : ''}`}
                                  title="Click to copy this value"
                                  onClick={() =>
                                    void handleCopyEmbeddedValue(copyId, jsonEntry.value)
                                  }
                                >
                                  <span className="inspector-embedded-json-path">
                                    {jsonEntry.path}
                                  </span>
                                  <span className="inspector-embedded-json-value">
                                    {jsonEntry.value}
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        ) : (
                          <button
                            type="button"
                            className={`inspector-embedded-value ${isCopied ? 'is-copied' : ''}`}
                            title="Click to copy full value"
                            onClick={() =>
                              void handleCopyEmbeddedValue(entry.id, entry.formattedValue)
                            }
                          >
                            <pre>{entry.formattedValue}</pre>
                          </button>
                        )}
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}
      </section>
    </div>
  );
};

export default React.memo(InspectorMetadataView);
