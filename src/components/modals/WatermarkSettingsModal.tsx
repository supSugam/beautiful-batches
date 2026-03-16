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
  MonitorCheck,
  Check,
} from 'lucide-react';
import type { WatermarkSidecarStatus } from '../../types/app';
import useStore from '../../store/useStore';
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

const HealthDot = ({ label, ok, error }: { label: string; ok: boolean; error?: boolean }) => (
  <div className="wsm-health-dot" title={`${label}: ${ok ? 'OK' : error ? 'Missing' : 'Pending'}`}>
    <span className={`wsm-led ${ok ? 'is-ok' : error ? 'is-error' : 'is-idle'}`} />
    <span className="wsm-health-label">{label}</span>
  </div>
);

const HardwareBadge: React.FC<{ type: string }> = ({ type }) => {
  const normalized = type.toLowerCase();
  let label = 'Unknown HW';
  let color = 'var(--text-secondary)';
  
  if (normalized === 'apple') {
    label = 'Apple Silicon';
    color = 'var(--text-bright)';
  } else if (normalized === 'nvidia') {
    label = 'NVIDIA GPU';
    color = '#76b900'; 
  } else if (normalized === 'amd') {
    label = 'AMD GPU';
    color = '#ed1c24';
  } else if (normalized === 'windows_gpu' || normalized.includes('gpu')) {
    label = 'DirectML GPU';
    color = 'var(--accent)';
  } else if (normalized === 'cpu') {
    label = 'CPU Mode';
    color = '#0071c5';
  }

  return (
    <div className="wsm-storage-pill" style={{ borderColor: color, color }}>
      <MonitorCheck size={11} />
      <span>{label}</span>
    </div>
  );
};

const DriverInstructions = ({ hw, os }: { hw: string; os: string }) => {
  if (hw === 'apple') {
    return (
      <div className="wsm-driver-box">
        <p>Your Mac is using <b>CoreML</b> and metal-accelerated <b>MPS</b>. No additional setup is required for maximum speed.</p>
      </div>
    );
  }

  if (os === 'windows') {
    return (
      <div className="wsm-driver-box">
        <p>To enable <b>DirectML</b> or <b>CUDA</b> acceleration on Windows, ensure your drivers are up-to-date:</p>
        <div className="wsm-command-list">
          <div className="wsm-command-item">
            <span>Drivers:</span>
            <code>{hw === 'nvidia' ? 'Download NVIDIA Studio Drivers' : 'Download AMD Adrenalin Software'}</code>
          </div>
        </div>
      </div>
    );
  }

  if (hw === 'amd' && os === 'linux') {
    return (
      <div className="wsm-driver-box">
        <p>AMD Integrated GPU detected. <b>OpenVINO Turbo Mode</b> is already active to give you 2-5x speed with 0MB extra disk space.</p>
        <div className="wsm-command-list">
          <div className="wsm-command-item is-advanced">
            <span>Optional (Discrete GPU only):</span>
            <p>If you have a powerful dedicated AMD card, you can install ROCm, but be aware it uses <b>20GB+ of disk space</b>.</p>
            <code>sudo apt install rocm-runtime</code>
          </div>
        </div>
      </div>
    );
  }
  if (hw === 'nvidia' && os === 'linux') {
    return (
      <div className="wsm-driver-box">
        <p>NVIDIA GPU detected, but CPU is being used. Install the <b>CUDA</b> toolkit:</p>
          <div className="wsm-command-item">
            <span>Ubuntu/Debian:</span>
            <code>sudo apt install nvidia-cuda-toolkit</code>
          </div>
      </div>
    );
  }
  return null;
};

const WatermarkSettingsModal = ({ onClose }: WatermarkSettingsModalProps) => {
  const lastUsedHardware = useStore((state) => state.lastUsedHardware);
  const [status, setStatus] = useState<WatermarkSidecarStatus | null>(null);
  const [isSetupRunning, setIsSetupRunning] = useState(false);
  const [downloadingModelId, setDownloadingModelId] = useState<string | null>(null);
  const [showWipeConfirm, setShowWipeConfirm] = useState(false);
  const [confirmDeleteModelId, setConfirmDeleteModelId] = useState<string | null>(null);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [selectedDetectionId, setSelectedDetectionId] = useState('florence-2-large');
  const [selectedInpaintingId, setSelectedInpaintingId] = useState('lama');

  const logsContainerRef = useRef<HTMLDivElement>(null);
  const wipeTimeoutRef = useRef<number | null>(null);
  const deleteTimeoutRef = useRef<Record<string, number>>({});

  useEffect(() => {
    return () => {
      if (wipeTimeoutRef.current) window.clearTimeout(wipeTimeoutRef.current);
      Object.values(deleteTimeoutRef.current).forEach(t => window.clearTimeout(t));
    };
  }, []);

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
    if (!showWipeConfirm) {
      setShowWipeConfirm(true);
      if (wipeTimeoutRef.current) window.clearTimeout(wipeTimeoutRef.current);
      wipeTimeoutRef.current = window.setTimeout(() => setShowWipeConfirm(false), 5000);
      return;
    }
    
    if (wipeTimeoutRef.current) window.clearTimeout(wipeTimeoutRef.current);
    try {
      await invoke('reset_watermark_setup');
      setLogs([]);
      await fetchStatus();
    } catch (error) {
      console.error('Reset failed:', error);
    } finally {
      setShowWipeConfirm(false);
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
    if (confirmDeleteModelId !== modelId) {
      setConfirmDeleteModelId(modelId);
      if (deleteTimeoutRef.current[modelId]) window.clearTimeout(deleteTimeoutRef.current[modelId]);
      deleteTimeoutRef.current[modelId] = window.setTimeout(() => {
        setConfirmDeleteModelId(prev => prev === modelId ? null : prev);
      }, 5000);
      return;
    }
    
    if (deleteTimeoutRef.current[modelId]) window.clearTimeout(deleteTimeoutRef.current[modelId]);
    try {
      await invoke('delete_watermark_model', { modelId });
      await fetchStatus();
    } catch (error) {
      console.error('Delete failed:', error);
    } finally {
      setConfirmDeleteModelId(null);
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
              <h2>Settings</h2>
              <p>Configure hardware acceleration and manage AI models for watermark removal.</p>
            </div>
          </div>
          
          <div className="wsm-header-right">
            {status && (
              <div className="wsm-storage-pill">
                <Database size={11} />
                <span>{formatBytes(status.totalSizeBytes)}</span>
              </div>
            )}
            <button
              type="button"
              className="btn-icon wsm-close"
              onClick={onClose}
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
        </header>

        {/* Body */}
        <div className="wsm-body">
          {!status ? (
            <div className="wsm-loading">
              <RefreshCcw size={22} className="spin" style={{ color: 'var(--accent)' }} />
              <span>Scanning environment…</span>
            </div>
          ) : (
            <>
              <div className="wsm-health-indicator-row">
                <HealthDot label="Hardware Detected" ok={true} />
                <HealthDot label="Python" ok={status.pythonInstalled} error={!status.pythonInstalled} />
                <HealthDot label="Git" ok={status.gitInstalled} />
                <HealthDot label="uv Runtime" ok={status.uvInstalled} />
                <HealthDot label="Repository" ok={status.repoCloned} />
                <HealthDot label="Dependencies" ok={status.dependenciesInstalled} />
                <HealthDot label="Bridge" ok={status.isBridgeActive} />
              </div>
              <div className="wsm-grid">
                {/* Left column: Health */}
                <div className="wsm-col">
                  <section className="wsm-card is-hardware">
                  <h3>Hardware Diagnostics</h3>
                  <div className="wsm-diag-info">
                    <div className="wsm-diag-row">
                      <span>Physical Hardware</span>
                      <HardwareBadge type={status.hardwareType || 'cpu'} />
                    </div>
                    <div className="wsm-diag-row">
                      <span>Active Engine</span>
                      <div className="wsm-diag-val">
                        {lastUsedHardware ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span className={
                              lastUsedHardware.toLowerCase().includes('cpu') ? 'is-warning' : 'is-success'
                            }>
                              {lastUsedHardware.replace('ExecutionProvider', '')}
                            </span>
                            {lastUsedHardware.includes('OpenVINO') && (
                              <span className="hw-badge is-turbo" title="OpenVINO CPU/iGPU Optimization Active">
                                <RefreshCcw size={10} className="spin-slow" />
                                TURBO
                              </span>
                            )}
                            {(lastUsedHardware.includes('CUDA') || lastUsedHardware.includes('ROCM') || lastUsedHardware.includes('CoreML') || lastUsedHardware.includes('DirectML')) && (
                              <span className="hw-badge is-accelerated" title="Hardware Acceleration Active">
                                <MonitorCheck size={10} />
                                ACCELERATED
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="is-dimmed">No process run yet</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {(status.hardwareType === 'amd' || status.hardwareType === 'nvidia') && 
                   (!lastUsedHardware || lastUsedHardware.toLowerCase().includes('cpu')) && (
                    <DriverInstructions 
                      hw={status.hardwareType} 
                      os={window.navigator.platform.toLowerCase().includes('win') ? 'windows' : 'linux'} 
                    />
                  )}
                </section>
              </div>

              {/* Right column: Unified model list + Logs */}
              <div className="wsm-col">
                <section className="wsm-card is-models">
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
                          <span className="wsm-model-desc">
                            {model.id.includes('large') ? '~3GB' : model.id.includes('base') ? '~1GB' : model.description}
                          </span>
                        </span>
                        <span className="wsm-model-action">
                          {model.downloaded ? (
                            <span className="wsm-model-ready">
                              <CheckCircle2 size={13} />
                              <span>{formatBytes(model.sizeBytes)}</span>
                              <button
                                type="button"
                                className={`btn-icon wsm-model-delete ${confirmDeleteModelId === model.id ? 'is-confirming' : ''}`}
                                onClick={(e) => { e.stopPropagation(); void handleDeleteModel(model.id); }}
                                aria-label="Delete model"
                                title={confirmDeleteModelId === model.id ? "Confirm Delete" : "Delete model"}
                              >
                                {confirmDeleteModelId === model.id ? <Check size={13} /> : <Trash2 size={13} />}
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
                              Download
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
                          <span className="wsm-model-desc">
                            {model.id === 'lama' ? '~200MB' : model.id === 'rembg' ? '~200MB' : model.description}
                          </span>
                        </span>
                        <span className="wsm-model-action">
                          {model.downloaded ? (
                            <span className="wsm-model-ready">
                              <CheckCircle2 size={13} />
                              <span>{formatBytes(model.sizeBytes)}</span>
                              <button
                                type="button"
                                className={`btn-icon wsm-model-delete ${confirmDeleteModelId === model.id ? 'is-confirming' : ''}`}
                                onClick={(e) => { e.stopPropagation(); void handleDeleteModel(model.id); }}
                                aria-label="Delete model"
                                title={confirmDeleteModelId === model.id ? "Confirm Delete" : "Delete model"}
                              >
                                {confirmDeleteModelId === model.id ? <Check size={13} /> : <Trash2 size={13} />}
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
                              Download
                            </span>
                          )}
                        </span>
                      </button>
                    ))}
                  </div>

                  {/* Background Removal group */}
                  <p className="wsm-model-group-label" style={{ marginTop: '12px' }}>BACKGROUND REMOVAL</p>
                  <div className="wsm-models-list">
                    {status.backgroundRemovalModels.map((model) => (
                      <button
                        key={model.id}
                        type="button"
                        className={`wsm-model-row ${model.id === 'rembg' ? 'is-selected' : ''}`}
                        style={{ cursor: 'default' }}
                      >
                        <span className="wsm-model-radio" />
                        <span className="wsm-model-info">
                          <span className="wsm-model-name">{model.name}</span>
                          <span className="wsm-model-desc">
                            {model.id === 'rembg' ? '~200MB' : model.description}
                          </span>
                        </span>
                        <span className="wsm-model-action">
                          {model.downloaded ? (
                            <span className="wsm-model-ready">
                              <CheckCircle2 size={13} />
                              <span>{formatBytes(model.sizeBytes)}</span>
                              <button
                                type="button"
                                className={`btn-icon wsm-model-delete ${confirmDeleteModelId === model.id ? 'is-confirming' : ''}`}
                                onClick={(e) => { e.stopPropagation(); void handleDeleteModel(model.id); }}
                                aria-label="Delete model"
                                title={confirmDeleteModelId === model.id ? "Confirm Delete" : "Delete model"}
                              >
                                {confirmDeleteModelId === model.id ? <Check size={13} /> : <Trash2 size={13} />}
                              </button>
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
                              Download
                            </span>
                          )}
                        </span>
                      </button>
                    ))}
                  </div>
                </section>
              </div>
            </div>
            
            <section className="wsm-card wsm-card-logs wsm-full-width-logs">
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
          </>
        )}
      </div>

        {/* Footer */}
        <footer className="wsm-footer">
          <div className="wsm-footer-left">
            <button
              type="button"
              className={`btn btn-sm btn-ghost btn-danger-ghost wsm-wipe-btn ${showWipeConfirm ? 'is-confirming' : ''}`}
              onClick={handleReset}
            >
              {showWipeConfirm ? <Check size={13} /> : <Trash2 size={13} />}
              Wipe Engine
            </button>
          </div>
          
          <div className="wsm-footer-status">
            {!status || isFullySetup ? null : (
              <span className="wsm-status-warn">
                <AlertTriangle size={13} />
                Setup Required
              </span>
            )}
          </div>

          <div className="wsm-footer-actions">
            <button
              type="button"
              className={`btn btn-sm ${isFullySetup ? 'btn-secondary' : 'btn-primary'}`}
              onClick={() => handleRunSetup()}
              disabled={isSetupRunning || !status?.pythonInstalled || !status?.gitInstalled}
            >
              <RefreshCcw size={13} className={isSetupRunning ? 'spin' : ''} />
              {isSetupRunning ? 'Rebuilding…' : status?.repoCloned ? 'Update System' : 'Install Engine'}
            </button>
          </div>
        </footer>
      </motion.section>
    </div>
  );
};

export default WatermarkSettingsModal;
