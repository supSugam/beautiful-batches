import React, { useEffect, useState, useRef } from 'react';
import { motion } from 'framer-motion';
import { 
  X, 
  Settings, 
  CheckCircle2, 
  AlertCircle, 
  Download, 
  Terminal, 
  RefreshCcw,
  ExternalLink,
  ChevronRight,
  GitBranch,
  Box
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import './WatermarkSettingsModal.css';

type WatermarkSetupStatus = {
  pythonInstalled: boolean;
  gitInstalled: boolean;
  uvInstalled: boolean;
  repoCloned: boolean;
  venvReady: boolean;
  depsInstalled: boolean;
  repoPath: string;
  pythonPath: string;
};

type WatermarkSettingsModalProps = {
  onClose: () => void;
};

const WatermarkSettingsModal = ({ onClose }: WatermarkSettingsModalProps) => {
  const [status, setStatus] = useState<WatermarkSetupStatus | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [isSettingUp, setIsSettingUp] = useState(false);
  const logEndRef = useRef<HTMLDivElement>(null);

  const fetchStatus = async () => {
    try {
      const res = await invoke<WatermarkSetupStatus>('get_watermark_setup_status');
      setStatus(res);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    fetchStatus();
    
    const unlisten = listen<string>('watermark-setup-progress', (event) => {
      setLogs(prev => [...prev, event.payload].slice(-100));
    });

    return () => {
      unlisten.then(f => f());
    };
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const runStep = async (step: string) => {
    setIsSettingUp(true);
    try {
      await invoke('run_watermark_setup_step', { step });
      await fetchStatus();
    } catch (e: any) {
      setLogs(prev => [...prev, `Error: ${e}`]);
    } finally {
      setIsSettingUp(false);
    }
  };

  const StatusItem = ({ 
    label, 
    value, 
    icon: Icon,
    description 
  }: { 
    label: string; 
    value: boolean; 
    icon: any;
    description: string;
  }) => (
    <div className={`watermark-setup-status-item ${value ? 'is-ready' : 'is-missing'}`}>
      <div className="status-item-icon">
        <Icon size={18} />
      </div>
      <div className="status-item-content">
        <div className="status-item-header">
          <span className="status-item-label">{label}</span>
          {value ? (
            <span className="status-badge ready">Ready</span>
          ) : (
            <span className="status-badge missing">Missing</span>
          )}
        </div>
        <p className="status-item-description">{description}</p>
      </div>
    </div>
  );

  return (
    <div className="export-plan-overlay" role="presentation" onMouseDown={e => e.target === e.currentTarget && onClose()}>
      <motion.section 
        layout
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="export-plan-modal watermark-setup-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Watermark AI setup"
      >
        <header className="export-plan-header">
          <div className="header-title">
            <Settings size={20} className="header-icon" />
            <div>
              <h2>AI Watermark Remover Setup</h2>
              <p>Configure the optional AI processing module</p>
            </div>
          </div>
          <button className="btn-icon export-plan-close" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </header>

        <div className="export-plan-body">
          <div className="export-plan-config-grid">
            <div className="setup-section status-section">
              <h3 className="section-label" style={{ marginBottom: '12px' }}>System Requirements</h3>
              <div className="status-list">
                <StatusItem 
                  label="Python" 
                  value={status?.pythonInstalled || false} 
                  icon={Box}
                  description="Required to run AI models and scripts."
                />
                <StatusItem 
                  label="Git" 
                  value={status?.gitInstalled || false} 
                  icon={GitBranch}
                  description="Required to clone and update the remover module."
                />
                <StatusItem 
                  label="UV (Optional)" 
                  value={status?.uvInstalled || false} 
                  icon={Terminal}
                  description="Blazing fast package manager. Recommended."
                />
              </div>

              <h3 className="section-label" style={{ marginTop: '24px', marginBottom: '12px' }}>Module Status</h3>
              <div className="status-list">
                <StatusItem 
                  label="Repository" 
                  value={status?.repoCloned || false} 
                  icon={Download}
                  description="The core remover source code."
                />
                <StatusItem 
                  label="Environment" 
                  value={status?.venvReady || false} 
                  icon={Box}
                  description="Isolated Python environment for dependencies."
                />
                <StatusItem 
                  label="Dependencies" 
                  value={status?.depsInstalled || false} 
                  icon={CheckCircle2}
                  description="AI libraries (PyTorch, Transformers, etc)."
                />
              </div>
            </div>

            <div className="setup-section actions-section" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div className="export-plan-card">
                <h3 className="section-label" style={{ marginBottom: '4px' }}>Setup Actions</h3>
                <div className="action-buttons" style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
                  <button 
                    className="btn-action" 
                    disabled={isSettingUp || !status?.gitInstalled}
                    onClick={() => runStep('clone')}
                  >
                    <Download size={16} />
                    <span>{status?.repoCloned ? 'Update Repo' : 'Clone Repo'}</span>
                    <ChevronRight size={14} className="arrow" />
                  </button>
                  
                  <button 
                    className="btn-action" 
                    disabled={isSettingUp || !status?.repoCloned || !status?.pythonInstalled}
                    onClick={() => runStep('venv')}
                  >
                    <Box size={16} />
                    <span>Create Venv</span>
                    <ChevronRight size={14} className="arrow" />
                  </button>

                  <button 
                    className="btn-action" 
                    disabled={isSettingUp || !status?.venvReady}
                    onClick={() => runStep('deps')}
                  >
                    <Terminal size={16} />
                    <span>Install Dependencies</span>
                    <ChevronRight size={14} className="arrow" />
                  </button>
                </div>

                <div className="terminal-logs" style={{ marginTop: '16px' }}>
                  <div className="terminal-header">
                    <Terminal size={12} />
                    <span>Setup Logs</span>
                    {isSettingUp && <RefreshCcw size={12} className="spin" />}
                  </div>
                  <div className="terminal-content">
                    {logs.length === 0 ? (
                      <span className="dim">No logs yet...</span>
                    ) : (
                      logs.map((log, i) => <div key={i} className="log-line">{log}</div>)
                    )}
                    <div ref={logEndRef} />
                  </div>
                </div>
              </div>

              <div className="info-box" style={{ 
                padding: '12px', 
                background: 'rgba(129, 140, 248, 0.05)', 
                border: '1px solid rgba(129, 140, 248, 0.2)', 
                borderRadius: 'var(--radius-ui)',
                display: 'flex',
                gap: '12px',
                alignItems: 'flex-start'
              }}>
                <AlertCircle size={16} style={{ color: 'var(--accent)', flexShrink: 0 }} />
                <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-secondary)', line_height: '1.4' }}>
                  This module requires about 2-4GB of disk space for dependencies and models. 
                  Models are downloaded automatically on first run.
                </p>
              </div>
            </div>
          </div>
        </div>

        <footer className="export-plan-footer">
          <div className="footer-links">
            <a href="https://github.com/supSugam/WatermarkRemover-AI" target="_blank" rel="noreferrer" style={{ 
              fontSize: '0.75rem', 
              color: 'var(--text-muted)', 
              text_decoration: 'none', 
              display: 'flex', 
              align_items: 'center', 
              gap: '4px' 
            }}>
              View Source <ExternalLink size={12} />
            </a>
          </div>
          <div className="export-plan-actions">
            <button className="btn btn-secondary" onClick={onClose}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={onClose}>
              {status?.depsInstalled ? 'Done' : 'Configure Later'}
            </button>
          </div>
        </footer>
      </motion.section>
    </div>
  );
};

export default WatermarkSettingsModal;
