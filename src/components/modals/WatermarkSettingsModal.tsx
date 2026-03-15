import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  X,
  CheckCircle2,
  AlertTriangle,
  Terminal,
  Cpu,
  RefreshCcw,
  Trash2,
  Download,
  Database,
} from 'lucide-react';
import type { WatermarkSidecarStatus } from '../../types/app';
import './WatermarkSettingsModal.css';

type WatermarkSettingsModalProps = {
  onClose: () => void;
};

type LogEntry = {
  message: string;
  isError: boolean;
  timestamp: number;
};

const formatBytes = (bytes: number): string => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
};

const HealthRow = ({ label, ok, error }: { label: string; ok: boolean; error?: boolean }) => (
  <div className="wsm-health-row">
    <span className={`wsm-led ${ok ? 'is-ok' : error ? 'is-error' : 'is-idle'}`} />
    <span className="wsm-health-label">{label}</span>
    <span className="wsm-health-status">{ok ? 'OK' : error ? 'Missing' : 'Pending'}</span>
  </div>
);

const WatermarkSettingsModal = ({ onClose }: WatermarkSettingsModalProps) => {
  const [status, setStatus] = useState<WatermarkSidecarStatus | null>(null);
  const [isSetupRunning, setIsSetupRunning] = useState(false);
  const [downloadingModelId, setDownloadingModelId] = useState<string | null>(null);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [selectedDetectionId, setSelectedDetectionId] = useState('florence-2-large');
  const [selectedInpaintingId, setSelectedInpaintingId] = useState('lama');

  const logsContainerRef = useRef<HTMLDivElement>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const nextStatus = await invoke<WatermarkSidecarStatus>('get_watermark_sidecar_status');
      setStatus(nextStatus);
    } catch (error) {
      console.error('Failed to fetch sidecar status:', error);
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  useEffect(() => {
    let unlistenFn: (() => void) | null = null;
    let isMounted = true;
    const setupListener = async () => {
      const unlisten = await listen<LogEntry>('watermark-setup-log', (event) => {
        if (!isMounted) return;
        setLogs((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.message === event.payload.message && last.timestamp === event.payload.timestamp) return prev;
          return [...prev, event.payload];
        });
      });
      if (isMounted) unlistenFn = unlisten; else unlisten();
    };
    void setupListener();
    return () => { isMounted = false; if (unlistenFn) unlistenFn(); };
  }, []);

  useEffect(() => {
    if (logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [logs]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); onClose(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  const handleRunSetup = async (force = false) => {
    if (isSetupRunning) return;
    setIsSetupRunning(true);
    setLogs([]);
    try {
      await invoke('run_watermark_setup', { forceReinstall: force });
      await fetchStatus();
    } catch (error) {
      console.error('Setup failed:', error);
    } finally {
      setIsSetupRunning(false);
    }
  };

  const handleLoadModels = async () => {
    if (isLoadingModels) return;
    setIsLoadingModels(true);
    try {
      const detId = selectedDetectionId === 'florence-2-large'
        ? 'florence-community/Florence-2-large'
        : 'florence-community/Florence-2-base';
      await invoke('load_watermark_models', { detectionModel: detId, inpaintingModel: selectedInpaintingId });
      await fetchStatus();
    } catch (error) {
      console.error('Failed to load models:', error);
      setLogs(prev => [...prev, { message: `Load failed: ${error}`, isError: true, timestamp: Date.now() }]);
    } finally {
      setIsLoadingModels(false);
    }
  };

  const handleReset = async () => {
    if (!window.confirm('Are you sure you want to delete the Watermark AI setup?')) return;
    try {
      await invoke('reset_watermark_setup');
      setLogs([]);
      await fetchStatus();
    } catch (error) {
      console.error('Reset failed:', error);
    }
  };

  const handleDownloadModel = async (modelId: string) => {
    if (downloadingModelId) return;
    setDownloadingModelId(modelId);
    try {
      await invoke('download_watermark_model', { modelId });
      await fetchStatus();
    } catch (error) {
      console.error('Download failed:', error);
    } finally {
      setDownloadingModelId(null);
    }
  };

  const handleDeleteModel = async (modelId: string) => {
    if (!window.confirm('Are you sure you want to delete this model?')) return;
    try {
      await invoke('delete_watermark_model', { modelId });
      await fetchStatus();
    } catch (error) {
      console.error('Delete failed:', error);
    }
  };

  const isFullySetup = status
    ? status.repoCloned && status.venvExists && status.dependenciesInstalled
    : false;

  return (
    <div
      className="wsm-overlay"
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <motion.section
        layout
        className="wsm-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Watermark AI Settings"
        initial={{ opacity: 0, y: 10, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
      >
        {/* Header */}
        <header className="wsm-header">
          <div className="wsm-header-left">
            <div className="wsm-header-icon">
              <Cpu size={14} />
            </div>
            <div>
              <h2>Watermark AI</h2>
              <p>Object detection and context-aware inpainting engine.</p>
            </div>
            {status && (
              <div className="wsm-storage-pill">
                <Database size={11} />
                <span>{formatBytes(status.totalSizeBytes)}</span>
              </div>
            )}
          </div>
          <button
            type="button"
            className="btn-icon wsm-close"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </header>

        {/* Body */}
        <div className="wsm-body">
          {!status ? (
            <div className="wsm-loading">
              <RefreshCcw size={22} className="spin" style={{ color: 'var(--accent)' }} />
              <span>Scanning environment…</span>
            </div>
          ) : (
            <div className="wsm-grid">
              {/* Left column: Health */}
              <div className="wsm-col">
                <section className="wsm-card">
                  <h3>Engine Health</h3>
                  <div className="wsm-health-list">
                    <HealthRow label="Python" ok={status.pythonInstalled} error={!status.pythonInstalled} />
                    <HealthRow label="Git" ok={status.gitInstalled} />
                    <HealthRow label="uv Runtime" ok={status.uvInstalled} />
                    <HealthRow label="Repository" ok={status.repoCloned} />
                    <HealthRow label="Dependencies" ok={status.dependenciesInstalled} />
                    <HealthRow label="Bridge" ok={status.isBridgeActive} />
                  </div>
                </section>
              </div>

              {/* Right column: Unified model list + Logs */}
              <div className="wsm-col">
                <section className="wsm-card">
                  <div className="wsm-models-header">
                    <h3>Models</h3>
                    <button
                      type="button"
                      className={`btn btn-sm ${status.isModelsLoaded ? 'btn-secondary' : 'btn-primary'}`}
                      disabled={!isFullySetup || isSetupRunning || isLoadingModels}
                      onClick={handleLoadModels}
                    >
                      {isLoadingModels
                        ? <RefreshCcw size={13} className="spin" />
                        : <Cpu size={13} />}
                      {status.isModelsLoaded ? 'Reload Engine' : 'Initialize Engine'}
                    </button>
                  </div>

                  {/* Detection group */}
                  <p className="wsm-model-group-label">Detection</p>
                  <div className="wsm-models-list">
                    {status.detectionModels.map((model) => (
                      <button
                        key={model.id}
                        type="button"
                        className={`wsm-model-row ${selectedDetectionId === model.id ? 'is-selected' : ''}`}
                        onClick={() => setSelectedDetectionId(model.id)}
                      >
                        <span className="wsm-model-radio" />
                        <span className="wsm-model-info">
                          <span className="wsm-model-name">{model.name}</span>
                          <span className="wsm-model-desc">{model.description}</span>
                        </span>
                        <span className="wsm-model-action">
                          {model.downloaded ? (
                            <span className="wsm-model-ready">
                              <CheckCircle2 size={13} />
                              <span>{formatBytes(model.sizeBytes)}</span>
                              <button
                                type="button"
                                className="btn-icon wsm-model-delete"
                                onClick={(e) => { e.stopPropagation(); void handleDeleteModel(model.id); }}
                                aria-label="Delete model"
                                title="Delete model"
                              >
                                <Trash2 size={13} />
                              </button>
                            </span>
                          ) : model.sizeBytes > 0 ? (
                            <span className="wsm-model-ready wsm-model-error">
                              <AlertTriangle size={13} style={{ color: 'var(--danger)' }} />
                              <span style={{ color: 'var(--danger)' }}>Incomplete ({formatBytes(model.sizeBytes)})</span>
                              <span
                                role="button"
                                className="wsm-deploy-btn"
                                onClick={(e) => { e.stopPropagation(); void handleDownloadModel(model.id); }}
                                aria-disabled={!isFullySetup || isSetupRunning || !!downloadingModelId}
                              >
                                {downloadingModelId === model.id
                                  ? <RefreshCcw size={12} className="spin" />
                                  : <Download size={12} />}
                                Redownload
                              </span>
                            </span>
                          ) : (
                            <span
                              role="button"
                              className="wsm-deploy-btn"
                              onClick={(e) => { e.stopPropagation(); void handleDownloadModel(model.id); }}
                              aria-disabled={!isFullySetup || isSetupRunning || !!downloadingModelId}
                            >
                              {downloadingModelId === model.id
                                ? <RefreshCcw size={12} className="spin" />
                                : <Download size={12} />}
                              Deploy
                            </span>
                          )}
                        </span>
                      </button>
                    ))}
                  </div>

                  {/* Inpainting group */}
                  <p className="wsm-model-group-label">Inpainting</p>
                  <div className="wsm-models-list">
                    {status.inpaintingModels.map((model) => (
                      <button
                        key={model.id}
                        type="button"
                        className={`wsm-model-row ${selectedInpaintingId === model.id ? 'is-selected' : ''}`}
                        onClick={() => setSelectedInpaintingId(model.id)}
                      >
                        <span className="wsm-model-radio" />
                        <span className="wsm-model-info">
                          <span className="wsm-model-name">{model.name}</span>
                          <span className="wsm-model-desc">{model.description}</span>
                        </span>
                        <span className="wsm-model-action">
                          {model.downloaded ? (
                            <span className="wsm-model-ready">
                              <CheckCircle2 size={13} />
                              <span>{formatBytes(model.sizeBytes)}</span>
                              <button
                                type="button"
                                className="btn-icon wsm-model-delete"
                                onClick={(e) => { e.stopPropagation(); void handleDeleteModel(model.id); }}
                                aria-label="Delete model"
                                title="Delete model"
                              >
                                <Trash2 size={13} />
                              </button>
                            </span>
                          ) : model.sizeBytes > 0 ? (
                            <span className="wsm-model-ready wsm-model-error">
                              <AlertTriangle size={13} style={{ color: 'var(--danger)' }} />
                              <span style={{ color: 'var(--danger)' }}>Incomplete ({formatBytes(model.sizeBytes)})</span>
                              <span
                                role="button"
                                className="wsm-deploy-btn"
                                onClick={(e) => { e.stopPropagation(); void handleDownloadModel(model.id); }}
                                aria-disabled={!isFullySetup || isSetupRunning || !!downloadingModelId}
                              >
                                {downloadingModelId === model.id
                                  ? <RefreshCcw size={12} className="spin" />
                                  : <Download size={12} />}
                                Redownload
                              </span>
                            </span>
                          ) : (
                            <span
                              role="button"
                              className="wsm-deploy-btn"
                              onClick={(e) => { e.stopPropagation(); void handleDownloadModel(model.id); }}
                              aria-disabled={!isFullySetup || isSetupRunning || !!downloadingModelId}
                            >
                              {downloadingModelId === model.id
                                ? <RefreshCcw size={12} className="spin" />
                                : <Download size={12} />}
                              Deploy
                            </span>
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>

                <section className="wsm-card wsm-card-logs">
                  <div className="wsm-logs-header">
                    <span><Terminal size={12} />Engine Streams</span>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => setLogs([])}>
                      Clear
                    </button>
                  </div>
                  <div className="wsm-log-body" ref={logsContainerRef}>
                    {logs.length === 0 ? (
                      <p className="wsm-log-empty">Waiting for signals…</p>
                    ) : (
                      logs.map((log, i) => (
                        <div key={`${log.timestamp}-${i}`} className={`wsm-log-entry ${log.isError ? 'is-error' : ''}`}>
                          <span className="wsm-log-time">
                            [{new Date(log.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}]
                          </span>
                          <span className="wsm-log-msg">{log.message}</span>
                        </div>
                      ))
                    )}
                  </div>
                </section>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <footer className="wsm-footer">
          <div className="wsm-footer-status">
            {!status ? null : isFullySetup ? (
              <span className="wsm-status-ok">
                <CheckCircle2 size={13} />
                AI Core Ready
              </span>
            ) : (
              <span className="wsm-status-warn">
                <AlertTriangle size={13} />
                Setup Required
              </span>
            )}
          </div>
          <div className="wsm-footer-actions">
            <button
              type="button"
              className="btn btn-sm btn-ghost btn-danger-ghost"
              onClick={handleReset}
            >
              <Trash2 size={13} />
              Wipe Engine
            </button>
            <button
              type="button"
              className={`btn btn-sm ${isFullySetup ? 'btn-secondary' : 'btn-primary'}`}
              onClick={() => handleRunSetup()}
              disabled={isSetupRunning || !status?.pythonInstalled || !status?.gitInstalled}
            >
              <RefreshCcw size={13} className={isSetupRunning ? 'spin' : ''} />
              {isSetupRunning ? 'Rebuilding…' : status?.repoCloned ? 'Update System' : 'One-Click Deploy'}
            </button>
          </div>
        </footer>
      </motion.section>
    </div>
  );
};

export default WatermarkSettingsModal;
