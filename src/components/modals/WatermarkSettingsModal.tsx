import React, { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import {
  X,
  CheckCircle2,
  AlertTriangle,
  Terminal,
  Cpu,
  RefreshCcw,
  RefreshCw,
  RotateCcw,
  Trash2,
  Download,
  Database,
  MonitorCheck,
  Check,
  Lightbulb,
  MousePointer2,
  Command,
  ChevronUp,
  Github,
  ClipboardCopy,
  ClipboardCheck,
  MessageSquare,
  Sparkles,
  Copy,
  Settings,
  GitBranch,
  Calendar,
  Hash,
} from 'lucide-react';
import useStore, { SettingsTab } from '../../store/useStore';
import { WatermarkSidecarStatus, WatermarkRegion } from '../../types/app';
import DesignDropdown, { DesignDropdownOption } from '../common/DesignDropdown';
import SegmentedControl from '../common/SegmentedControl';
import OpenRouterLogo from '../icons/OpenRouterLogo';
import './WatermarkSettingsModal.css';

/* ROI presets removed in favor of context-menu based custom regions */

type WatermarkSettingsModalProps = {
  initialTab?: SettingsTab;
  onClose: () => void;
};

type LogEntry = {
  message: string;
  isError: boolean;
  timestamp: number;
};

type GitInfo = {
  hash: string;
  date: string;
};

const DEFAULT_JSON_TEMPLATE = `{\n  "messages": [\n    {\n      "role": "user",\n      "content": [\n        { "type": "text", "text": "{{prompt}}" },\n        { "type": "image_url", "image_url": { "url": "{{image}}" } }\n      ]\n    }\n  ]\n}`;

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

const GeminiGradient = () => (
  <svg width="0" height="0" style={{ position: 'absolute', pointerEvents: 'none', opacity: 0 }}>
    <defs>
      <linearGradient id="gemini_grad" x1="18.447" y1="43.42" x2="52.153" y2="15.004" gradientUnits="userSpaceOnUse">
        <stop stopColor="#4893FC"/><stop offset=".27" stopColor="#4893FC"/><stop offset=".777" stopColor="#969DFF"/><stop offset="1" stopColor="#BD99FE"/>
      </linearGradient>
    </defs>
  </svg>
);

const GeminiLogo = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 65 65" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M32.447 0c.68 0 1.273.465 1.439 1.125a38.904 38.904 0 001.999 5.905c2.152 5 5.105 9.376 8.854 13.125 3.751 3.75 8.126 6.703 13.125 8.855a38.98 38.98 0 005.906 1.999c.66.166 1.124.758 1.124 1.438 0 .68-.464 1.273-1.125 1.439a38.902 38.902 0 00-5.905 1.999c-5 2.152-9.375 5.105-13.125 8.854-3.749 3.751-6.702 8.126-8.854 13.125a38.973 38.973 0 00-2 5.906 1.485 1.485 0 01-1.438 1.124c-.68 0-1.272-.464-1.438-1.125a38.913 38.913 0 00-2-5.905c-2.151-5-5.103-9.375-8.854-13.125-3.75-3.749-8.125-6.702-13.125-8.854a38.973 38.973 0 00-5.905-2A1.485 1.485 0 010 32.448c0-.68.465-1.272 1.125-1.438a38.903 38.903 0 005.905-2c5-2.151 9.376-5.104 13.125-8.854 3.75-3.749 6.703-8.125 8.855-13.125a38.972 38.972 0 001.999-5.905A1.485 1.485 0 0132.447 0z" fill="url(#gemini_grad)"/>
  </svg>
);

const ClaudeLogo = ({ size = 18 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 1200 1200" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path fill="#d97757" d="M 233.959793 800.214905 L 468.644287 668.536987 L 472.590637 657.100647 L 468.644287 650.738403 L 457.208069 650.738403 L 417.986633 648.322144 L 283.892639 644.69812 L 167.597321 639.865845 L 54.926208 633.825623 L 26.577238 627.785339 L 3.3e-05 592.751709 L 2.73832 575.27533 L 26.577238 559.248352 L 60.724873 562.228149 L 136.187973 567.382629 L 249.422867 575.194763 L 331.570496 580.026978 L 453.261841 592.671082 L 472.590637 592.671082 L 475.328857 584.859009 L 468.724915 580.026978 L 463.570557 575.194763 L 346.389313 495.785217 L 219.543671 411.865906 L 153.100723 363.543762 L 117.181267 339.060425 L 99.060455 316.107361 L 91.248367 266.01355 L 123.865784 230.093994 L 167.677887 233.073853 L 178.872513 236.053772 L 223.248367 270.201477 L 318.040283 343.570496 L 441.825592 434.738342 L 459.946411 449.798706 L 467.194672 444.64447 L 468.080597 441.020203 L 459.946411 427.409485 L 392.617493 305.718323 L 320.778564 181.932983 L 288.80542 130.630859 L 280.348999 99.865845 C 277.369171 87.221436 275.194641 76.590698 275.194641 63.624268 L 312.322174 13.20813 L 332.8591 6.604126 L 382.389313 13.20813 L 403.248352 31.328979 L 434.013519 101.71814 L 483.865753 212.537048 L 561.181274 363.221497 L 583.812134 407.919434 L 595.892639 449.315491 L 600.40271 461.959839 L 608.214783 461.959839 L 608.214783 454.711609 L 614.577271 369.825623 L 626.335632 265.61084 L 637.771851 131.516846 L 641.718201 93.745117 L 660.402832 48.483276 L 697.530334 24.000122 L 726.52356 37.852417 L 750.362549 72 L 747.060486 94.067139 L 732.886047 186.201416 L 705.100708 330.52356 L 686.979919 427.167847 L 697.530334 427.167847 L 709.61084 415.087341 L 758.496704 350.174561 L 840.644348 247.490051 L 876.885925 206.738342 L 919.167847 161.71814 L 946.308838 140.29541 L 997.61084 140.29541 L 1035.38269 196.429626 L 1018.469849 254.416199 L 965.637634 321.422852 L 921.825562 378.201538 L 859.006714 462.765259 L 819.785278 530.41626 L 823.409424 535.812073 L 832.75177 534.92627 L 974.657776 504.724915 L 1051.328979 490.872559 L 1142.818848 475.167786 L 1184.214844 494.496582 L 1188.724854 514.147644 L 1172.456421 554.335693 L 1074.604126 578.496765 L 959.838989 601.449829 L 788.939636 641.879272 L 786.845764 643.409485 L 789.261841 646.389343 L 866.255127 653.637634 L 899.194702 655.409424 L 979.812134 655.409424 L 1129.932861 666.604187 L 1169.154419 692.537109 L 1192.671265 724.268677 L 1188.724854 748.429688 L 1128.322144 779.194641 L 1046.818848 759.865845 L 856.590759 714.604126 L 791.355774 698.335754 L 782.335693 698.335754 L 782.335693 703.731567 L 836.69812 756.885986 L 936.322205 846.845581 L 1061.073975 962.81897 L 1067.436279 991.490112 L 1051.409424 1014.120911 L 1034.496704 1011.704712 L 924.885986 929.234924 L 882.604126 892.107544 L 786.845764 811.48999 L 780.483276 811.48999 L 780.483276 819.946289 L 802.550415 852.241699 L 919.087341 1027.409424 L 925.127625 1081.127686 L 916.671204 1098.604126 L 886.469849 1109.154419 L 853.288696 1103.114136 L 785.073914 1007.355835 L 714.684631 899.516785 L 657.906067 802.872498 L 650.979858 806.81897 L 617.476624 1167.704834 L 601.771851 1186.147705 L 565.530212 1200 L 535.328857 1177.046997 L 519.302124 1139.919556 L 535.328857 1066.550537 L 554.657776 970.792053 L 570.362488 894.68457 L 584.536926 800.134277 L 592.993347 768.724976 L 592.429626 766.630859 L 585.503479 767.516968 L 514.22821 865.369263 L 405.825531 1011.865906 L 320.053711 1103.677979 L 299.516815 1111.812256 L 263.919525 1093.369263 L 267.221497 1060.429688 L 287.114136 1031.114136 L 405.825531 880.107361 L 477.422913 786.52356 L 523.651062 732.483276 L 523.328918 724.671265 L 520.590698 724.671265 L 205.288605 929.395935 L 149.154434 936.644409 L 124.993355 914.01355 L 127.973183 876.885986 L 139.409409 864.80542 L 234.201385 799.570435 L 233.879227 799.8927 Z" />
  </svg>
);

const ChatGPTLogo = ({ size = 18, color = "white" }: { size?: number; color?: string }) => (
  <svg width={size} height={size} viewBox="0 0 320 320" xmlns="http://www.w3.org/2000/svg">
    <path fill={color} d="m297.06 130.97c7.26-21.79 4.76-45.66-6.85-65.48-17.46-30.4-52.56-46.04-86.84-38.68-15.25-17.18-37.16-26.95-60.13-26.81-35.04-.08-66.13 22.48-76.91 55.82-22.51 4.61-41.94 18.7-53.31 38.67-17.59 30.32-13.58 68.54 9.92 94.54-7.26 21.79-4.76 45.66 6.85 65.48 17.46 30.4 52.56 46.04 86.84 38.68 15.24 17.18 37.16 26.95 60.13 26.8 35.06.09 66.16-22.49 76.94-55.86 22.51-4.61 41.94-18.7 53.31-38.67 17.57-30.32 13.55-68.51-9.94-94.51zm-120.28 168.11c-14.03.02-27.62-4.89-38.39-13.88.49-.26 1.34-.73 1.89-1.07l63.72-36.8c3.26-1.85 5.26-5.32 5.24-9.07v-89.83l26.93 15.55c.29.14.48.42.52.74v74.39c-.04 33.08-26.83 59.9-59.91 59.97zm-128.84-55.03c-7.03-12.14-9.56-26.37-7.15-40.18.47.28 1.3.79 1.89 1.13l63.72 36.8c3.23 1.89 7.23 1.89 10.47 0l77.79-44.92v31.1c.02.32-.13.63-.38.83l-64.41 37.19c-28.69 16.52-65.33 6.7-81.92-21.95zm-16.77-139.09c7-12.16 18.05-21.46 31.21-26.29 0 .55-.03 1.52-.03 2.2v73.61c-.02 3.74 1.98 7.21 5.23 9.06l77.79 44.91-26.93 15.55c-.27.18-.61.21-.91.08l-64.42-37.22c-28.63-16.58-38.45-53.21-21.95-81.89zm221.26 51.49-77.79-44.92 26.93-15.54c.27-.18.61-.21.91-.08l64.42 37.19c28.68 16.57 38.51 53.26 21.94 81.94-7.01 12.14-18.05 21.44-31.2 26.28v-75.81c.03-3.74-1.96-7.2-5.2-9.06zm26.8-40.34c-.47-.29-1.3-.79-1.89-1.13l-63.72-36.8c-3.23-1.89-7.23-1.89-10.47 0l-77.79 44.92v-31.1c-.02-.32.13-.63.38-.83l64.41-37.16c28.69-16.55 65.37-6.7 81.91 22 6.99 12.12 9.52 26.31 7.15 40.1zm-168.51 55.43-26.94-15.55c-.29-.14-.48-.42-.52-.74v-74.39c.02-33.12 26.89-59.96 60.01-59.94 14.01 0 27.57 4.92 38.34 13.88-.49.26-1.33.73-1.89 1.07l-63.72 36.8c-3.26 1.85-5.26 5.31-5.24 9.06l-.04 89.79zm14.63-31.54 34.65-20.01 34.65 20v40.01l-34.65 20-34.65-20z" />
  </svg>
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

const fallbackGoogleModelOptions: DesignDropdownOption[] = [
  { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', description: 'Stable fast vision model', icon: <GeminiLogo size={14} /> },
  { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro', description: 'Stable multimodal with large context', icon: <GeminiLogo size={14} /> },
  { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash', description: 'Stable fast vision analysis', icon: <GeminiLogo size={14} /> },
];

let cachedGoogleOptions: DesignDropdownOption[] | null = null;

const openaiModelOptions: DesignDropdownOption[] = [
  { value: 'gpt-4o', label: 'GPT-4o', description: 'Omni model with native vision capabilities', icon: <ChatGPTLogo size={14} color="white" /> },
  { value: 'gpt-4o-mini', label: 'GPT-4o Mini', description: 'Lightweight and fast vision analysis', icon: <ChatGPTLogo size={14} color="white" /> },
  { value: 'o1', label: 'GPT-o1', description: 'Advanced reasoning with vision support', icon: <ChatGPTLogo size={14} color="white" /> },
];

const anthropicModelOptions: DesignDropdownOption[] = [
  { value: 'claude-3-5-sonnet-latest', label: 'Claude 3.5 Sonnet', description: 'Exceptional image reasoning and detail', icon: <ClaudeLogo size={14} /> },
  { value: 'claude-3-5-haiku-latest', label: 'Claude 3.5 Haiku', description: 'Ultra-fast vision understanding', icon: <ClaudeLogo size={14} /> },
  { value: 'claude-3-opus-latest', label: 'Claude 3 Opus', description: 'Deepest multimodal comprehension', icon: <ClaudeLogo size={14} /> },
];

// Providers known to only have .png on openrouter (no .svg)
const pngOnlyProviders = new Set(['qwen', 'mistralai']);

const providerOpenRouterIconMap: Record<string, string> = {
  google: 'GoogleGemini',
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  'meta-llama': 'Meta',
  mistralai: 'Mistral',
  cohere: 'Cohere',
  qwen: 'Qwen',
  'x-ai': 'X',
  xiaomi: 'Xiaomi',
  'z-ai': 'Zhipu',
  moonshot: 'Moonshot',
  nvidia: 'NvidiaAPI',
  deepseek: 'DeepSeek',
  microsoft: 'Microsoft',
  '01-ai': '01',
  databricks: 'Databricks',
  'arcee-ai': 'ArceeAI',
  minimax: 'MiniMax',
  amazon: 'Amazon',
  bytedance: 'ByteDance',
  reka: 'Reka',
};

const providerDomainMap: Record<string, string> = {
  google: 'google.com',
  openai: 'openai.com',
  anthropic: 'anthropic.com',
  'meta-llama': 'meta.com',
  mistralai: 'mistral.ai',
  cohere: 'cohere.com',
  qwen: 'qwenlm.github.io',
  'x-ai': 'x.ai',
  xiaomi: 'xiaomi.com',
  'z-ai': 'zhipuai.cn',
  moonshot: 'moonshot.ai',
  'arcee-ai': 'arcee.ai',
  nvidia: 'nvidia.com',
  '01-ai': '01.ai',
  databricks: 'databricks.com',
  microsoft: 'microsoft.com',
  deepseek: 'deepseek.com',
  amazon: 'nova.amazon.com',
  bytedance: 'seed.bytedance.com',
  minimax: 'minimaxi.com',
  reka: 'huggingface.co',
};

const ModelIcon = ({ providerId }: { providerId: string }) => {
  // 0 = openrouter .svg, 1 = openrouter .png, 2 = google favicon, 3 = logo fallback
  const startStage = pngOnlyProviders.has(providerId) ? 1 : 0;
  const [stage, setStage] = useState<0 | 1 | 2 | 3>(startStage);

  if (stage === 3) return <OpenRouterLogo size={14} />;

  const shouldInvert = providerId === 'openai';
  const filterStyle = shouldInvert ? 'invert(1) brightness(2)' : 'none';

  let src: string;
  if (stage === 0 || stage === 1) {
    const iconName = providerOpenRouterIconMap[providerId] ||
      (providerId.charAt(0).toUpperCase() + providerId.slice(1));
    const ext = stage === 0 ? 'svg' : 'png';
    src = `https://openrouter.ai/images/icons/${iconName}.${ext}`;
  } else {
    const domain = providerDomainMap[providerId] || `${providerId}.com`;
    src = `https://t0.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON&fallback_opts=TYPE,SIZE,URL&url=https://${domain}&size=256`;
  }

  return (
    <img
      src={src}
      width={14}
      height={14}
      onError={() => setStage(prev => Math.min(prev + 1, 3) as 1 | 2 | 3)}
      alt={providerId}
      style={{ objectFit: 'contain', filter: filterStyle, borderRadius: '2px' }}
    />
  );
};

const initialOpenRouterModelOptions: DesignDropdownOption[] = [
  { value: 'meta-llama/llama-3.2-11b-vision-instruct:free', label: 'Llama 3.2 11B Vision (Free)', description: 'Free vision model via OpenRouter', icon: <ModelIcon providerId="meta-llama" /> },
  { value: 'google/gemini-2.5-flash', label: 'Gemini 2.5 Flash', description: 'Fast multimodal via OpenRouter', icon: <ModelIcon providerId="google" /> },
  { value: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet', description: 'Excellent vision via OpenRouter', icon: <ModelIcon providerId="anthropic" /> },
];


let cachedOpenRouterOptions: DesignDropdownOption[] | null = null;

const JsonEditor = ({
  value,
  onChange,
  error,
  readOnly = false,
}: {
  value: string;
  onChange?: (val: string) => void;
  error?: string | null;
  readOnly?: boolean;
}) => {
  const [localValue, setLocalValue] = useState(value);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (readOnly) return;
    const val = e.target.value;
    setLocalValue(val);
    onChange?.(val);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (readOnly) return;
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = e.currentTarget.selectionStart;
      const end = e.currentTarget.selectionEnd;
      const newValue = localValue.substring(0, start) + '  ' + localValue.substring(end);
      setLocalValue(newValue);
      onChange?.(newValue);
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = textareaRef.current.selectionEnd = start + 2;
        }
      }, 0);
    }
  };

  return (
    <div className={`wsm-json-editor ${error ? 'has-error' : ''} ${readOnly ? 'is-readonly' : ''}`}>
      <div className="wsm-json-container">
        <textarea
          ref={textareaRef}
          value={localValue}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          spellCheck={false}
          autoComplete="off"
          placeholder={readOnly ? "No response data available yet." : "Enter JSON structure..."}
          readOnly={readOnly}
        />
      </div>
    </div>
  );
};

const WatermarkSettingsModal = ({ initialTab = 'engine', onClose }: WatermarkSettingsModalProps) => {
  const lastUsedHardware = useStore((state) => state.lastUsedHardware);
  const autoUnload = useStore((state) => state.autoUnload);
  const setAutoUnload = useStore((state) => state.setAutoUnload);
  const selectedId = useStore((state) => state.selectedId);
  const currentCrop = useStore(
    useCallback((state) => state.cropData.get(selectedId || ''), [selectedId]),
  );
  const updateCropEntry = useStore((state) => state.updateCropEntry);
  const [status, setStatus] = useState<WatermarkSidecarStatus | null>(null);
  const [isSetupRunning, setIsSetupRunning] = useState(false);
  const [downloadingModelId, setDownloadingModelId] = useState<string | null>(null);
  const [showWipeConfirm, setShowWipeConfirm] = useState(false);
  const [confirmDeleteModelId, setConfirmDeleteModelId] = useState<string | null>(null);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [selectedDetectionId, setSelectedDetectionId] = useState('florence-2-large');
  const [selectedInpaintingId, setSelectedInpaintingId] = useState('lama');

  const [activeTab, setActiveTab] = useState<SettingsTab>(initialTab);

  const captioningSettings = useStore((state) => state.captioningSettings);
  const setCaptioningSettings = useStore((state) => state.setCaptioningSettings);
  const updateProviderSettings = useStore((state) => state.updateProviderSettings);
  const addToast = useStore((state) => state.addToast);
  const [logsCopied, setLogsCopied] = useState(false);
  const [customApiTab, setCustomApiTab] = useState<'prompt' | 'payload' | 'response'>('prompt');
  const [jsonError, setJsonError] = useState<string | null>(null);
  const [lastCustomPrompt, setLastCustomPrompt] = useState<string | null>(null);
  const logsContainerRef = useRef<HTMLDivElement>(null);

  const [openrouterModelOptions, setOpenrouterModelOptions] = useState<DesignDropdownOption[]>(
    cachedOpenRouterOptions || initialOpenRouterModelOptions
  );
  const [googleModelOptions, setGoogleModelOptions] = useState<DesignDropdownOption[]>(
    cachedGoogleOptions || fallbackGoogleModelOptions
  );

  useEffect(() => {
    const apiKey = captioningSettings.google?.apiKey;
    if (captioningSettings.provider === 'google' && apiKey && !cachedGoogleOptions) {
      const fetchGoogleModels = async () => {
        try {
          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}&pageSize=200`
          );
          const data = await res.json();
          if (!data.models) return;
          const EXCLUDE = /tts|audio|live|embedding|robotics|computer.use|deep.research|nano.banana|image(?!\w)/i;
          const visionModels = data.models.filter((m: any) =>
            m.supportedGenerationMethods?.includes('generateContent') &&
            m.name.startsWith('models/gemini-') &&
            !EXCLUDE.test(m.name)
          );
          visionModels.sort((a: any, b: any) => b.name.localeCompare(a.name));
          const options = visionModels.map((m: any) => {
            const id = m.name.replace('models/', '');
            const label = m.displayName || id;
            return {
              value: id,
              label,
              description: m.description?.slice(0, 60) || 'Google Gemini model',
              icon: <GeminiLogo size={14} />,
            };
          });
          if (options.length > 0) {
            cachedGoogleOptions = options;
            setGoogleModelOptions(options);
          }
        } catch (e) {
          console.error('Failed to fetch Google models:', e);
        }
      };
      fetchGoogleModels();
    }
  }, [captioningSettings.provider, captioningSettings.google?.apiKey]);

  useEffect(() => {
    if (captioningSettings.provider === 'openrouter' && !cachedOpenRouterOptions) {
      const fetchModels = async () => {
        try {
          const res = await fetch('https://openrouter.ai/api/v1/models');
          const data = await res.json();
          const visionModels = data.data.filter((m: any) => 
            m.architecture?.input_modalities?.includes('image') || 
            (m.architecture?.modality && String(m.architecture.modality).includes('image'))
          );
          
          visionModels.sort((a: any, b: any) => {
            const aFree = a.pricing?.prompt === "0" || a.pricing?.prompt === 0;
            const bFree = b.pricing?.prompt === "0" || b.pricing?.prompt === 0;
            if (aFree && !bFree) return -1;
            if (!aFree && bFree) return 1;
            return a.name.localeCompare(b.name);
          });

          const options = visionModels.map((m: any) => {
            const providerId = m.id.split('/')[0];
            return {
              value: m.id,
              label: m.name,
              description: `Max Context: ${m.context_length} | ${m.pricing?.prompt === "0" || m.pricing?.prompt === 0 ? 'Free' : 'Paid'}`,
              icon: <ModelIcon providerId={providerId} />,
            };
          });
          
          if (options.length > 0) {
            cachedOpenRouterOptions = options;
            setOpenrouterModelOptions(options);
          }
        } catch (e) {
          console.error("Failed to fetch OpenRouter models:", e);
        }
      };
      fetchModels();
    }
  }, [captioningSettings.provider]);

  const applyPreset = useCallback((presetValue: string) => {
    const current = captioningSettings.systemPrompt;
    const presets = [
      'Provide a clear, objective, and concise description of the image. Focus on the primary subjects, their actions, and the overall setting without unnecessary interpretation.',
      'Acting as an expert Alt-Text generator, describe this image in high detail for accessibility. Focus on the central subject, specific colors, textures, lighting, spatial layout, and any legible text. Adhere to WCAG 2.1 AA standards for clarity and usability.',
      'Write a creative and evocative caption that captures the mood, atmosphere, and emotional tone of the scene. Utilize vivid terminology and metaphors to bring the stylistic elements, color palette, and "story" of the image to life.'
    ];
    
    // If current is NOT a preset and NOT empty, back it up
    if (current && !presets.includes(current)) {
      setLastCustomPrompt(current);
    }
    
    setCaptioningSettings({ systemPrompt: presetValue });
  }, [captioningSettings.systemPrompt, setCaptioningSettings]);

  const revertPrompt = useCallback(() => {
    if (lastCustomPrompt !== null) {
      setCaptioningSettings({ systemPrompt: lastCustomPrompt });
      setLastCustomPrompt(null);
    }
  }, [lastCustomPrompt, setCaptioningSettings]);
  const wipeTimeoutRef = useRef<number | null>(null);
  const deleteTimeoutRef = useRef<Record<string, number>>({});

  useEffect(() => {
    return () => {
      if (wipeTimeoutRef.current) window.clearTimeout(wipeTimeoutRef.current);
      Object.values(deleteTimeoutRef.current).forEach(t => window.clearTimeout(t));
    };
  }, []);

  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const nextStatus = await invoke<WatermarkSidecarStatus>('get_watermark_sidecar_status');
      setStatus(nextStatus);
    } catch (error) {
      console.error('Failed to fetch sidecar status:', error);
    }
  }, []);

  useEffect(() => {
    const fetchGitInfo = async () => {
      try {
        const info = await invoke<GitInfo>('get_git_info');
        setGitInfo(info);
      } catch (e) {
        console.error('Failed to fetch git info:', e);
      }
    };
    fetchGitInfo();
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

  useEffect(() => {
    const loadSecureKeys = async () => {
      const providers = ['google', 'openai', 'anthropic', 'openrouter'] as const;
      for (const provider of providers) {
        try {
          const key = await invoke<string>('get_secure_api_key', { provider });
          if (key) {
            updateProviderSettings(provider, { apiKey: key });
          }
        } catch (error) {
          console.error(`Failed to load secure key for ${provider}:`, error);
        }
      }
    };
    loadSecureKeys();
  }, [updateProviderSettings]);

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

  const handleUnloadModels = async () => {
    try {
      await invoke('stop_watermark_models');
      await fetchStatus();
    } catch (error) {
      console.error('Failed to unload models:', error);
    }
  };

  const handleRestartBridge = async () => {
    if (isLoadingModels) return;
    setIsLoadingModels(true);
    try {
      await invoke('restart_watermark_bridge');
      // Auto-reloads with currently selected models
      const detId = selectedDetectionId === 'florence-2-large'
        ? 'florence-community/Florence-2-large'
        : 'florence-community/Florence-2-base';
      await invoke('load_watermark_models', { detectionModel: detId, inpaintingModel: selectedInpaintingId });
      await fetchStatus();
      setLogs(prev => [...prev, { message: 'Engine restarted. Local changes applied.', isError: false, timestamp: Date.now() }]);
    } catch (error) {
      console.error('Failed to restart engine:', error);
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

  const handleCopyLogs = async () => {
    if (logsCopied) return;

    const appVersion = '0.5.0';
    const os = window.navigator.platform;
    const userAgent = window.navigator.userAgent;
    const hw = status?.hardwareType || 'unknown';
    
    // Get detailed Linux info if available
    let detailedInfoText = '';
    try {
      const detailedInfo = await invoke<{ distro?: string; distroVersion?: string; desktopEnvironment?: string }>('get_detailed_system_info');
      if (detailedInfo.distro) detailedInfoText += `Distro: ${detailedInfo.distro}\n`;
      if (detailedInfo.distroVersion) detailedInfoText += `Distro Version: ${detailedInfo.distroVersion}\n`;
      if (detailedInfo.desktopEnvironment) detailedInfoText += `Desktop Environment: ${detailedInfo.desktopEnvironment}\n`;
    } catch (e) {
      console.error('Failed to get detailed system info', e);
    }

    let metadata = `--- SYSTEM INFO ---\n`;
    metadata += `App Version: ${appVersion}\n`;
    metadata += `Platform: ${os}\n`;
    metadata += detailedInfoText;
    metadata += `Hardware: ${hw.toUpperCase()}\n`;
    metadata += `User Agent: ${userAgent}\n`;
    metadata += `-------------------\n\n`;

    const logText = logs.map(l => {
      const time = new Date(l.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
      return `[${time}] ${l.isError ? 'ERROR: ' : ''}${l.message}`;
    }).join('\n');

    const fullContent = metadata + (logText || 'No logs available');
    
    let copied = false;
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(fullContent);
        copied = true;
      }
    } catch (err) {
      console.error('Clipboard API failed:', err);
    }

    if (!copied && typeof document !== 'undefined') {
      const textarea = document.createElement('textarea');
      textarea.value = fullContent;
      textarea.setAttribute('readonly', 'true');
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      textarea.style.pointerEvents = 'none';
      document.body.appendChild(textarea);
      textarea.select();
      try {
        copied = document.execCommand('copy');
      } catch (err) {
        console.error('execCommand copy failed:', err);
      } finally {
        document.body.removeChild(textarea);
      }
    }

    if (copied) {
      setLogsCopied(true);
      setTimeout(() => setLogsCopied(false), 2000);
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
      <GeminiGradient />
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
              <p>
                Configure hardware acceleration and manage AI models for
                watermark removal.
              </p>
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

        {/* Tabs Bar */}
        <nav className="wsm-tabs" aria-label="Settings Tabs">
          <button
            type="button"
            className={`wsm-tab ${activeTab === 'engine' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('engine')}
          >
            <Cpu size={14} />
            AI Engine
            {activeTab === 'engine' && (
              <motion.div
                layoutId="wsm-tab-indicator"
                className="wsm-tab-active-indicator"
              />
            )}
          </button>

          <button
            type="button"
            className={`wsm-tab ${activeTab === 'captioning' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('captioning')}
          >
            <MessageSquare size={14} />
            Captioning
            {activeTab === 'captioning' && (
              <motion.div
                layoutId="wsm-tab-indicator"
                className="wsm-tab-active-indicator"
              />
            )}
          </button>

          <button
            type="button"
            className={`wsm-tab ${activeTab === 'tips' ? 'is-active' : ''}`}
            onClick={() => setActiveTab('tips')}
          >
            <Lightbulb size={14} />
            Tips & Shortcuts
            {activeTab === 'tips' && (
              <motion.div
                layoutId="wsm-tab-indicator"
                className="wsm-tab-active-indicator"
              />
            )}
          </button>
        </nav>

        <div className="wsm-tab-content-wrapper">
          <AnimatePresence mode="wait">
            {activeTab === 'engine' && (
              <motion.div
                key="engine"
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
                className="wsm-tab-pane"
              >
                {/* Body */}
                <div className="wsm-body is-scrollable">
                  {!status ? (
                    <div className="wsm-loading">
                      <RefreshCcw
                        size={22}
                        className="spin"
                        style={{ color: 'var(--accent)' }}
                      />
                      <span>Scanning environment…</span>
                    </div>
                  ) : (
                    <>
                      <div className="wsm-health-indicator-row">
                        <HealthDot label="Hardware Detected" ok={true} />
                        <HealthDot
                          label="Python"
                          ok={status.pythonInstalled}
                          error={!status.pythonInstalled}
                        />
                        <HealthDot label="Git" ok={status.gitInstalled} />
                        <HealthDot label="uv Runtime" ok={status.uvInstalled} />
                        <HealthDot label="Repository" ok={status.repoCloned} />
                        <HealthDot
                          label="Dependencies"
                          ok={status.dependenciesInstalled}
                        />
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
                                <HardwareBadge
                                  type={status.hardwareType || 'cpu'}
                                />
                              </div>
                              <div className="wsm-diag-row">
                                <span>Engine Status</span>
                                <div className="wsm-diag-val">
                                  {status.isBridgeBusy ? (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                      <RefreshCcw size={12} className="spin" style={{ color: 'var(--accent)' }} />
                                      <span style={{ color: 'var(--accent)' }}>Processing…</span>
                                      {status.loadedDevice && (
                                        <span className={`hw-badge ${status.loadedDevice.toLowerCase().includes('cpu') ? 'is-turbo' : 'is-accelerated'}`}>
                                          {status.loadedDevice.replace('ExecutionProvider', '')}
                                        </span>
                                      )}
                                    </div>
                                  ) : status.isBridgeActive ? (
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                      <span className="is-success">Active</span>
                                      {status.loadedDevice && (
                                        <span className={`hw-badge ${status.loadedDevice.toLowerCase().includes('cpu') ? 'is-turbo' : 'is-accelerated'}`}>
                                          {status.loadedDevice.replace('ExecutionProvider', '')}
                                        </span>
                                      )}
                                    </div>
                                  ) : (
                                    <span className="is-dimmed">Idle / Unloaded</span>
                                  )}
                                </div>
                              </div>
                              <div className="wsm-diag-row">
                                <span>Last Run Device</span>
                                <div className="wsm-diag-val">
                                  {lastUsedHardware ? (
                                    <div
                                      style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '6px',
                                      }}
                                    >
                                      <span
                                        className={
                                          lastUsedHardware
                                            .toLowerCase()
                                            .includes('cpu')
                                            ? 'is-warning'
                                            : 'is-success'
                                        }
                                      >
                                        {lastUsedHardware.replace(
                                          'ExecutionProvider',
                                          '',
                                        )}
                                      </span>
                                      {lastUsedHardware.includes(
                                        'OpenVINO',
                                      ) && (
                                        <span
                                          className="hw-badge is-turbo"
                                          title="OpenVINO CPU/iGPU Optimization Active"
                                        >
                                          <RefreshCcw
                                            size={10}
                                            className="spin-slow"
                                          />
                                          TURBO
                                        </span>
                                      )}
                                      {(lastUsedHardware.includes('CUDA') ||
                                        lastUsedHardware.includes('ROCM') ||
                                        lastUsedHardware.includes('CoreML') ||
                                        lastUsedHardware.includes(
                                          'DirectML',
                                        )) && (
                                        <span
                                          className="hw-badge is-accelerated"
                                          title="Hardware Acceleration Active"
                                        >
                                          <MonitorCheck size={10} />
                                          ACCELERATED
                                        </span>
                                      )}
                                    </div>
                                  ) : (
                                    <span className="is-dimmed">
                                      No process run yet
                                    </span>
                                  )}
                                </div>
                              </div>

                              <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--border)' }}>
                                <div className="wsm-diag-row" style={{ alignItems: 'flex-start' }}>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', flex: 1 }}>
                                    <span style={{ fontWeight: 600, color: 'var(--text-bright)' }}>Auto Unload Engine</span>
                                    <p style={{ fontSize: '0.65rem', color: 'var(--text-muted)', margin: 0, lineHeight: 1.3 }}>
                                      Recommended. Automatically stops the AI process after use to free up GPU and RAM.
                                    </p>
                                  </div>
                                  <div 
                                    className={`wsm-toggle ${autoUnload ? 'is-active' : ''}`}
                                    onClick={() => setAutoUnload(!autoUnload)}
                                    role="checkbox"
                                    aria-checked={autoUnload}
                                    tabIndex={0}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        setAutoUnload(!autoUnload);
                                      }
                                    }}
                                  >
                                    <div className="wsm-toggle-handle" />
                                  </div>
                                </div>
                              </div>
                            </div>

                            {(status.hardwareType === 'amd' ||
                              status.hardwareType === 'nvidia') &&
                              (!lastUsedHardware ||
                                lastUsedHardware
                                  .toLowerCase()
                                  .includes('cpu')) && (
                                <DriverInstructions
                                  hw={status.hardwareType}
                                  os={
                                    window.navigator.platform
                                      .toLowerCase()
                                      .includes('win')
                                      ? 'windows'
                                      : 'linux'
                                  }
                                />
                              )}
                          </section>
                        </div>

                        {/* Right column: Unified model list + Logs */}
                        <div className="wsm-col">
                          <section className="wsm-card is-models">
                            <div className="wsm-models-header">
                              <h3>Models</h3>
                              <div style={{ display: 'flex', gap: '8px' }}>
                                {status.isBridgeActive && (
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-ghost btn-danger-ghost"
                                    onClick={handleUnloadModels}
                                    title="Kill the AI process and free GPU/RAM"
                                  >
                                    <X size={13} />
                                    Unload Engine
                                  </button>
                                )}
                                <button
                                  type="button"
                                  className={`btn btn-sm ${status.isBridgeActive ? 'btn-secondary' : 'btn-primary'}`}
                                  disabled={
                                    !isFullySetup ||
                                    isSetupRunning ||
                                    isLoadingModels
                                  }
                                  onClick={handleLoadModels}
                                >
                                  {isLoadingModels ? (
                                    <RefreshCcw size={13} className="spin" />
                                  ) : (
                                    <Cpu size={13} />
                                  )}
                                  {status.isBridgeActive
                                    ? 'Reload Engine'
                                    : 'Initialize Engine'}
                                </button>
                              </div>
                            </div>

                            {/* Detection group */}
                            <p className="wsm-model-group-label">Detection</p>
                            <div className="wsm-models-list">
                              {status.detectionModels.map((model) => (
                                <div
                                  key={model.id}
                                  className={`wsm-model-row ${selectedDetectionId === model.id ? 'is-selected' : ''}`}
                                  onClick={() =>
                                    setSelectedDetectionId(model.id)
                                  }
                                  role="button"
                                  tabIndex={0}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault();
                                      setSelectedDetectionId(model.id);
                                    }
                                  }}
                                >
                                  <span className="wsm-model-radio" />
                                  <span className="wsm-model-info">
                                    <span className="wsm-model-name">
                                      {model.name}
                                      {status.loadedDetectionModel === (model.id === 'florence-2-large' ? 'florence-community/Florence-2-large' : 'florence-community/Florence-2-base') && (
                                        <span className="wsm-loaded-badge">LOADED</span>
                                      )}
                                    </span>
                                    <span className="wsm-model-desc">
                                      {model.id.includes('large')
                                        ? '~3GB'
                                        : model.id.includes('base')
                                          ? '~1GB'
                                          : model.description}
                                    </span>
                                  </span>
                                  <span className="wsm-model-action">
                                    {model.downloaded ? (
                                      <span className="wsm-model-ready">
                                        <CheckCircle2 size={13} />
                                        <span>
                                          {formatBytes(model.sizeBytes)}
                                        </span>
                                        <button
                                          type="button"
                                          className={`btn-icon wsm-model-delete ${confirmDeleteModelId === model.id ? 'is-confirming' : ''}`}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            void handleDeleteModel(model.id);
                                          }}
                                          aria-label="Delete model"
                                          title={
                                            confirmDeleteModelId === model.id
                                              ? 'Confirm Delete'
                                              : 'Delete model'
                                          }
                                        >
                                          {confirmDeleteModelId === model.id ? (
                                            <Check size={13} />
                                          ) : (
                                            <Trash2 size={13} />
                                          )}
                                        </button>
                                      </span>
                                    ) : model.sizeBytes > 0 ? (
                                      <span className="wsm-model-ready wsm-model-error">
                                        <AlertTriangle
                                          size={13}
                                          style={{ color: 'var(--danger)' }}
                                        />
                                        <span
                                          style={{ color: 'var(--danger)' }}
                                        >
                                          Incomplete (
                                          {formatBytes(model.sizeBytes)})
                                        </span>
                                        <span
                                          role="button"
                                          className="wsm-deploy-btn"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            void handleDownloadModel(model.id);
                                          }}
                                          aria-disabled={
                                            !isFullySetup ||
                                            isSetupRunning ||
                                            !!downloadingModelId
                                          }
                                        >
                                          {downloadingModelId === model.id ? (
                                            <RefreshCcw
                                              size={12}
                                              className="spin"
                                            />
                                          ) : (
                                            <Download size={12} />
                                          )}
                                          Redownload
                                        </span>
                                      </span>
                                    ) : (
                                      <span
                                        role="button"
                                        className="wsm-deploy-btn"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          void handleDownloadModel(model.id);
                                        }}
                                        aria-disabled={
                                          !isFullySetup ||
                                          isSetupRunning ||
                                          !!downloadingModelId
                                        }
                                      >
                                        {downloadingModelId === model.id ? (
                                          <RefreshCcw
                                            size={12}
                                            className="spin"
                                          />
                                        ) : (
                                          <Download size={12} />
                                        )}
                                        Download
                                      </span>
                                    )}
                                  </span>
                                </div>
                              ))}
                            </div>

                            {/* Inpainting group */}
                            <p className="wsm-model-group-label">Inpainting</p>
                            <div className="wsm-models-list">
                              {status.inpaintingModels.map((model) => (
                                <div
                                  key={model.id}
                                  className={`wsm-model-row ${selectedInpaintingId === model.id ? 'is-selected' : ''}`}
                                  onClick={() =>
                                    setSelectedInpaintingId(model.id)
                                  }
                                  role="button"
                                  tabIndex={0}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' || e.key === ' ') {
                                      e.preventDefault();
                                      setSelectedInpaintingId(model.id);
                                    }
                                  }}
                                >
                                  <span className="wsm-model-radio" />
                                  <span className="wsm-model-info">
                                    <span className="wsm-model-name">
                                      {model.name}
                                      {status.loadedInpaintingModel === model.id && (
                                        <span className="wsm-loaded-badge">LOADED</span>
                                      )}
                                    </span>
                                    <span className="wsm-model-desc">
                                      {model.id === 'lama'
                                        ? '~200MB'
                                        : model.id === 'rembg'
                                          ? '~200MB'
                                          : model.description}
                                    </span>
                                  </span>
                                  <span className="wsm-model-action">
                                    {model.downloaded ? (
                                      <span className="wsm-model-ready">
                                        <CheckCircle2 size={13} />
                                        <span>
                                          {formatBytes(model.sizeBytes)}
                                        </span>
                                        <button
                                          type="button"
                                          className={`btn-icon wsm-model-delete ${confirmDeleteModelId === model.id ? 'is-confirming' : ''}`}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            void handleDeleteModel(model.id);
                                          }}
                                          aria-label="Delete model"
                                          title={
                                            confirmDeleteModelId === model.id
                                              ? 'Confirm Delete'
                                              : 'Delete model'
                                          }
                                        >
                                          {confirmDeleteModelId === model.id ? (
                                            <Check size={13} />
                                          ) : (
                                            <Trash2 size={13} />
                                          )}
                                        </button>
                                      </span>
                                    ) : model.sizeBytes > 0 ? (
                                      <span className="wsm-model-ready wsm-model-error">
                                        <AlertTriangle
                                          size={13}
                                          style={{ color: 'var(--danger)' }}
                                        />
                                        <span
                                          style={{ color: 'var(--danger)' }}
                                        >
                                          Incomplete (
                                          {formatBytes(model.sizeBytes)})
                                        </span>
                                        <span
                                          role="button"
                                          className="wsm-deploy-btn"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            void handleDownloadModel(model.id);
                                          }}
                                          aria-disabled={
                                            !isFullySetup ||
                                            isSetupRunning ||
                                            !!downloadingModelId
                                          }
                                        >
                                          {downloadingModelId === model.id ? (
                                            <RefreshCcw
                                              size={12}
                                              className="spin"
                                            />
                                          ) : (
                                            <Download size={12} />
                                          )}
                                          Redownload
                                        </span>
                                      </span>
                                    ) : (
                                      <span
                                        role="button"
                                        className="wsm-deploy-btn"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          void handleDownloadModel(model.id);
                                        }}
                                        aria-disabled={
                                          !isFullySetup ||
                                          isSetupRunning ||
                                          !!downloadingModelId
                                        }
                                      >
                                        {downloadingModelId === model.id ? (
                                          <RefreshCcw
                                            size={12}
                                            className="spin"
                                          />
                                        ) : (
                                          <Download size={12} />
                                        )}
                                        Download
                                      </span>
                                    )}
                                  </span>
                                </div>
                              ))}
                            </div>

                            {/* Background Removal group */}
                            <p
                              className="wsm-model-group-label"
                              style={{ marginTop: '12px' }}
                            >
                              BACKGROUND REMOVAL
                            </p>
                            <div className="wsm-models-list">
                              {status.backgroundRemovalModels.map((model) => (
                                <div
                                  key={model.id}
                                  className={`wsm-model-row ${model.id === 'rembg' ? 'is-selected' : ''}`}
                                  style={{ cursor: 'default' }}
                                  role="group"
                                >
                                  <span className="wsm-model-radio" />
                                  <span className="wsm-model-info">
                                    <span className="wsm-model-name">
                                      {model.name}
                                      {status.isBgRemovalLoaded && model.id === 'rembg' && (
                                        <span className="wsm-loaded-badge">LOADED</span>
                                      )}
                                    </span>
                                    <span className="wsm-model-desc">
                                      {model.id === 'rembg'
                                        ? '~200MB'
                                        : model.description}
                                    </span>
                                  </span>
                                  <span className="wsm-model-action">
                                    {model.downloaded ? (
                                      <span className="wsm-model-ready">
                                        <CheckCircle2 size={13} />
                                        <span>
                                          {formatBytes(model.sizeBytes)}
                                        </span>
                                        <button
                                          type="button"
                                          className={`btn-icon wsm-model-delete ${confirmDeleteModelId === model.id ? 'is-confirming' : ''}`}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            void handleDeleteModel(model.id);
                                          }}
                                          aria-label="Delete model"
                                          title={
                                            confirmDeleteModelId === model.id
                                              ? 'Confirm Delete'
                                              : 'Delete model'
                                          }
                                        >
                                          {confirmDeleteModelId === model.id ? (
                                            <Check size={13} />
                                          ) : (
                                            <Trash2 size={13} />
                                          )}
                                        </button>
                                      </span>
                                    ) : (
                                      <span
                                        role="button"
                                        className="wsm-deploy-btn"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          void handleDownloadModel(model.id);
                                        }}
                                        aria-disabled={
                                          !isFullySetup ||
                                          isSetupRunning ||
                                          !!downloadingModelId
                                        }
                                      >
                                        {downloadingModelId === model.id ? (
                                          <RefreshCcw
                                            size={12}
                                            className="spin"
                                          />
                                        ) : (
                                          <Download size={12} />
                                        )}
                                        Download
                                      </span>
                                    )}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </section>
                        </div>
                      </div>




                      <section className="wsm-card wsm-card-logs wsm-full-width-logs">
                        <div className="wsm-logs-header">
                          <span>
                            <Terminal size={12} />
                            Engine Streams
                          </span>
                          <div style={{ display: 'flex', gap: '8px' }}>
                            <button
                              type="button"
                              className={`btn btn-sm btn-ghost wsm-copy-btn ${logsCopied ? 'is-success' : ''}`}
                              onClick={handleCopyLogs}
                              title="Copy logs and system info for bug reports"
                            >
                              {logsCopied ? <ClipboardCheck size={13} /> : <ClipboardCopy size={13} />}
                              {logsCopied ? 'Copied' : 'Copy Logs'}
                            </button>

                            <button
                              type="button"
                              className="btn btn-sm btn-ghost"
                              onClick={() => setLogs([])}
                            >
                              Clear
                            </button>
                          </div>
                        </div>
                        <div className="wsm-log-body" ref={logsContainerRef}>
                          {logs.length === 0 ? (
                            <p className="wsm-log-empty">
                              Waiting for signals…
                            </p>
                          ) : (
                            logs.map((log, i) => (
                              <div
                                key={`${log.timestamp}-${i}`}
                                className={`wsm-log-entry ${log.isError ? 'is-error' : ''}`}
                              >
                                <span className="wsm-log-time">
                                  [
                                  {new Date(log.timestamp).toLocaleTimeString(
                                    [],
                                    {
                                      hour12: false,
                                      hour: '2-digit',
                                      minute: '2-digit',
                                      second: '2-digit',
                                    },
                                  )}
                                  ]
                                </span>
                                <span className="wsm-log-msg">
                                  {log.message}
                                </span>
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
                      {showWipeConfirm ? (
                        <Check size={13} />
                      ) : (
                        <Trash2 size={13} />
                      )}
                      Wipe Engine
                    </button>
                  </div>

                  <div className="wsm-footer-status">
                    {gitInfo ? (
                      <span className="wsm-version-info" title={`Built from commit ${gitInfo.hash} on ${new Date(parseInt(gitInfo.date) * 1000).toLocaleString()}`}>
                        {gitInfo.hash} • {new Date(parseInt(gitInfo.date) * 1000).toLocaleString()}
                      </span>
                    ) : null}
                    {!status || isFullySetup ? null : (
                      <span className="wsm-status-warn">
                        <AlertTriangle size={13} />
                        Setup Required
                      </span>
                    )}
                  </div>

                  <div className="wsm-footer-actions">
                    {status?.repoCloned && (
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        onClick={handleRestartBridge}
                        disabled={isLoadingModels || isSetupRunning}
                        title="Restart the AI process to apply local Python code changes"
                      >
                        {isLoadingModels ? <RefreshCcw size={13} className="spin" /> : <RefreshCcw size={13} />}
                        Apply Changes
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn-sm btn-secondary"
                      onClick={() => handleRunSetup()}
                      disabled={isSetupRunning}
                      title="Pull latest engine code from GitHub"
                    >
                      <Download
                        size={13}
                        className={isSetupRunning ? 'spin' : ''}
                      />
                      {isSetupRunning
                        ? 'Updating…'
                        : status?.repoCloned
                          ? 'Update Engine'
                          : 'Install Engine'}
                    </button>
                  </div>
                </footer>
              </motion.div>
            )}

            {activeTab === 'captioning' && (
              <motion.div
                key="captioning"
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.98 }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
                className="wsm-tab-pane"
              >
                <div className="wsm-body" style={{ overflow: 'hidden' }}>
                  <div className="wsm-captioning-layout">
                    {/* Left Column: Provider & Model */}
                    <div className="wsm-captioning-col">
                      <section className="wsm-card">
                        <h3>AI Provider</h3>
                        <div className="wsm-provider-grid">
                          <button
                            type="button"
                            className={`wsm-provider-btn ${captioningSettings.provider === 'google' ? 'is-active' : ''}`}
                            onClick={() => setCaptioningSettings({ ...captioningSettings, provider: 'google' })}
                          >
                            <GeminiLogo size={24} />
                            <span>Gemini</span>
                          </button>
                          <button
                            type="button"
                            className={`wsm-provider-btn ${captioningSettings.provider === 'openai' ? 'is-active' : ''} is-disabled`}
                            onClick={() => setCaptioningSettings({ ...captioningSettings, provider: 'openai' })}
                            title="OpenAI support coming soon"
                          >
                            <ChatGPTLogo size={24} color="white" />
                            <span>OpenAI</span>
                            <div className="wsm-coming-soon">Soon</div>
                          </button>
                          <button
                            type="button"
                            className={`wsm-provider-btn ${captioningSettings.provider === 'anthropic' ? 'is-active' : ''} is-disabled`}
                            onClick={() => setCaptioningSettings({ ...captioningSettings, provider: 'anthropic' })}
                            title="Anthropic support coming soon"
                          >
                            <ClaudeLogo size={24} />
                            <span>Anthropic</span>
                            <div className="wsm-coming-soon">Soon</div>
                          </button>
                          <button
                            type="button"
                            className={`wsm-provider-btn ${captioningSettings.provider === 'openrouter' ? 'is-active' : ''}`}
                            onClick={() => setCaptioningSettings({ provider: 'openrouter' })}
                          >
                            <OpenRouterLogo size={24} className="icon-gradient" />
                            <span>OpenRouter</span>
                          </button>
                          <button
                            type="button"
                            className={`wsm-provider-btn ${captioningSettings.provider === 'custom' ? 'is-active' : ''}`}
                            onClick={() => setCaptioningSettings({ provider: 'custom' })}
                          >
                            <Terminal size={24} color="white" />
                            <span>Custom API</span>
                          </button>
                        </div>
                      </section>

                      {captioningSettings.provider !== 'custom' ? (
                        <>
                          <section className="wsm-card">
                            <h3>Model Selection</h3>
                            <div className="wsm-model-select-wrap">
                              {captioningSettings.provider === 'google' && (
                                <DesignDropdown
                                  value={captioningSettings.google.model}
                                  options={googleModelOptions}
                                  onChange={(val) => updateProviderSettings('google', { model: val })}
                                />
                              )}
                              {captioningSettings.provider === 'openai' && (
                                <DesignDropdown
                                  value={captioningSettings.openai.model}
                                  options={openaiModelOptions}
                                  onChange={(val) => updateProviderSettings('openai', { model: val })}
                                />
                              )}
                              {captioningSettings.provider === 'anthropic' && (
                                <DesignDropdown
                                  value={captioningSettings.anthropic.model}
                                  options={anthropicModelOptions}
                                  onChange={(val) => updateProviderSettings('anthropic', { model: val })}
                                />
                              )}
                              {captioningSettings.provider === 'openrouter' && (
                                <DesignDropdown
                                  value={captioningSettings.openrouter?.model || 'meta-llama/llama-3.2-11b-vision-instruct:free'}
                                  options={openrouterModelOptions}
                                  onChange={(val) => updateProviderSettings('openrouter', { model: val })}
                                />
                              )}
                            </div>
                          </section>

                          <section className="wsm-card">
                            <h3>API Key</h3>
                            <div className="wsm-input-wrapper">
                              <input
                                type="password"
                                placeholder={`Enter ${captioningSettings.provider.charAt(0).toUpperCase() + captioningSettings.provider.slice(1)} API Key`}
                                className="wsm-input"
                                value={captioningSettings[captioningSettings.provider]?.apiKey || ''}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  updateProviderSettings(captioningSettings.provider, { apiKey: val });
                                  invoke('save_secure_api_key', { provider: captioningSettings.provider, key: val });
                                }}
                              />
                            </div>
                            <p className="wsm-input-hint">
                              Keys are stored locally and never sent to our servers.
                            </p>
                          </section>
                        </>
                      ) : (
                        <section className="wsm-card is-full-height" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                          <h3 style={{ marginBottom: 12, flexShrink: 0 }}>Custom API Configuration</h3>
                          
                          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12, overflowY: 'auto', paddingRight: 4, paddingBottom: 4 }}>
                            <label className="export-plan-field">
                              <span>Endpoint URL</span>
                              <input 
                                type="text" 
                                placeholder="http://localhost:11434/v1/chat/completions"
                                className="input"
                                value={captioningSettings.custom.endpoint}
                                onChange={(e) => updateProviderSettings('custom', { endpoint: e.target.value })}
                              />
                            </label>

                            <label className="export-plan-field">
                              <span>Authentication Header (Optional)</span>
                              <input
                                type="password"
                                placeholder="Bearer <Key>"
                                className="input"
                                value={captioningSettings.custom.apiKey}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  updateProviderSettings('custom', { apiKey: val });
                                  invoke('save_secure_api_key', { provider: 'custom', key: val });
                                }}
                              />
                            </label>

                            <label className="export-plan-field">
                              <span>Response JSON Path</span>
                              <input 
                                type="text" 
                                placeholder="choices[0].message.content"
                                className="input"
                                value={captioningSettings.custom.responseField}
                                onChange={(e) => updateProviderSettings('custom', { responseField: e.target.value })}
                              />
                            </label>
                          </div>
                        </section>
                      )}
                    </div>

                    {/* Right Column: Instructions / JSON Payload (custom API uses segmented control) */}
                    <div className="wsm-captioning-col">
                      <section className="wsm-card is-full-height">
                        {captioningSettings.provider === 'custom' && (
                          <div className="wsm-custom-tab-header">
                            <SegmentedControl
                              value={customApiTab}
                              options={[
                                { value: 'prompt', label: 'Instructions' },
                                { value: 'payload', label: 'Payload' },
                                { value: 'response', label: 'Response' },
                              ]}
                              onChange={(v) => setCustomApiTab(v as any)}
                              ariaLabel="Custom API editor tab"
                              equalWidth
                            />
                          </div>
                        )}

                        {/* System Instructions panel */}
                        <div 
                          className="wsm-custom-tab-pane" 
                          style={{ display: (captioningSettings.provider !== 'custom' || customApiTab === 'prompt') ? 'flex' : 'none' }}
                        >
                          {captioningSettings.provider !== 'custom' && (
                            <div className="section-header">
                              <h3 className="section-label">System Instructions</h3>
                              <div className="section-header-tools">
                                <button 
                                  type="button" 
                                  className="btn-icon-subtle"
                                  onClick={revertPrompt}
                                  disabled={!lastCustomPrompt}
                                  title={lastCustomPrompt ? "Restore your previous custom prompt" : "No custom prompt to restore"}
                                >
                                  <RotateCcw size={12} />
                                </button>
                              </div>
                            </div>
                          )}
                          {captioningSettings.provider === 'custom' && (
                            <div className="section-header">
                              <div className="section-header-tools" style={{ marginLeft: 'auto' }}>
                                <button 
                                  type="button" 
                                  className="btn-icon-subtle"
                                  onClick={revertPrompt}
                                  disabled={!lastCustomPrompt}
                                  title={lastCustomPrompt ? "Restore your previous custom prompt" : "No custom prompt to restore"}
                                >
                                  <RotateCcw size={12} />
                                </button>
                              </div>
                            </div>
                          )}
                          <div className="wsm-textarea-wrapper">
                            <textarea
                              className="wsm-textarea"
                              placeholder="e.g. Generate a concise and accurate caption for this image. Focus on the main subject and key details."
                              value={captioningSettings.systemPrompt}
                              onChange={(e) => setCaptioningSettings({ systemPrompt: e.target.value })}
                            />
                            <div className="wsm-prompt-pills">
                              <button 
                                type="button" 
                                className="wsm-pill"
                                onClick={() => applyPreset('Provide a clear, objective, and concise description of the image. Focus on the primary subjects, their actions, and the overall setting without unnecessary interpretation.')}
                              >
                                Standard
                              </button>
                              <button 
                                type="button" 
                                className="wsm-pill"
                                onClick={() => applyPreset('Acting as an expert Alt-Text generator, describe this image in high detail for accessibility. Focus on the central subject, specific colors, textures, lighting, spatial layout, and any legible text. Adhere to WCAG 2.1 AA standards for clarity and usability.')}
                              >
                                Detailed
                              </button>
                              <button 
                                type="button" 
                                className="wsm-pill"
                                onClick={() => applyPreset('Write a creative and evocative caption that captures the mood, atmosphere, and emotional tone of the scene. Utilize vivid terminology and metaphors to bring the stylistic elements, color palette, and "story" of the image to life.')}
                              >
                                Creative
                              </button>
                            </div>
                          </div>
                        </div>

                        {/* JSON Payload panel — only in Custom API mode */}
                        <div 
                          className="wsm-custom-tab-pane" 
                          style={{ display: (captioningSettings.provider === 'custom' && customApiTab === 'payload') ? 'flex' : 'none' }}
                        >
                          <div className="wsm-json-editor-header" style={{ flexWrap: 'nowrap' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 1, minWidth: 0 }}>
                              <span className="export-plan-token" style={{ flexShrink: 0 }}>{`{{image}}`}</span>
                              <span className="export-plan-token" style={{ flexShrink: 0 }}>{`{{prompt}}`}</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                              {jsonError && (
                                <span className="wsm-json-error-pill">
                                  <AlertTriangle size={11} />
                                  {jsonError}
                                </span>
                              )}
                              <button
                                type="button"
                                className="btn-icon-subtle"
                                title="Format JSON"
                                onClick={() => {
                                  const raw = captioningSettings.custom.customBodyTemplate ?? DEFAULT_JSON_TEMPLATE;
                                  try {
                                    const parsed = JSON.parse(raw);
                                    updateProviderSettings('custom', { customBodyTemplate: JSON.stringify(parsed, null, 2) });
                                    setJsonError(null);
                                  } catch (e) {
                                    setJsonError('Invalid JSON');
                                  }
                                }}
                              >
                                <Sparkles size={13} />
                              </button>
                            </div>
                          </div>
                          <JsonEditor
                            value={captioningSettings.custom.customBodyTemplate ?? DEFAULT_JSON_TEMPLATE}
                            onChange={(val) => {
                              updateProviderSettings('custom', { customBodyTemplate: val });
                              setJsonError(null);
                            }}
                            error={jsonError}
                          />
                        </div>

                        {/* Response panel */}
                        <div 
                          className="wsm-custom-tab-pane" 
                          style={{ display: (captioningSettings.provider === 'custom' && customApiTab === 'response') ? 'flex' : 'none' }}
                        >
                          <div className="wsm-json-editor-header" style={{ flexWrap: 'nowrap' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 1, minWidth: 0 }}>
                              <span className="export-plan-token" style={{ flexShrink: 0, opacity: 0.7 }}>Last API Response</span>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                              <button
                                type="button"
                                className="btn-icon-subtle"
                                title="Copy to Clipboard"
                                onClick={() => {
                                  if (captioningSettings.custom.lastResponse) {
                                    navigator.clipboard.writeText(captioningSettings.custom.lastResponse);
                                    addToast('Response copied to clipboard', 'success');
                                  }
                                }}
                                disabled={!captioningSettings.custom.lastResponse}
                              >
                                <Copy size={13} />
                              </button>
                            </div>
                          </div>
                          <JsonEditor
                            value={captioningSettings.custom.lastResponse ? (
                              (() => {
                                try {
                                  return JSON.stringify(JSON.parse(captioningSettings.custom.lastResponse), null, 2);
                                } catch {
                                  return captioningSettings.custom.lastResponse;
                                }
                              })()
                            ) : ''}
                            readOnly={true}
                          />
                        </div>
                      </section>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'tips' && (
              <motion.div
                key="tips"
                initial={{ opacity: 0, x: 10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 10 }}
                transition={{ duration: 0.15, ease: 'easeOut' }}
                className="wsm-tab-pane wsm-tips-container"
              >
                <div className="wsm-tip-card">
                  <div className="wsm-tip-header">
                    <div className="wsm-tip-icon-wrap">
                      <MousePointer2 size={18} />
                    </div>
                    <h4 className="wsm-tip-title">Snapping Bypass</h4>
                  </div>
                  <div className="wsm-tip-content">
                    <p className="wsm-tip-desc">
                      Hold <span className="wsm-key-hint"><ChevronUp size={12} className="wsm-key-icon" /> Shift</span> while dragging
                      to temporarily disable all magnetic snapping and guides.
                    </p>
                  </div>
                </div>

                <div className="wsm-tip-card">
                  <div className="wsm-tip-header">
                    <div className="wsm-tip-icon-wrap">
                      <Command size={18} />
                    </div>
                    <h4 className="wsm-tip-title">Ratio Locking</h4>
                  </div>
                  <div className="wsm-tip-content">
                    <p className="wsm-tip-desc">
                      Hold <span className="wsm-key-hint">Ctrl</span> or{' '}
                      <span className="wsm-key-hint"><Command size={11} className="wsm-key-icon" /> Cmd</span> while resizing to
                      lock the current aspect ratio.
                    </p>
                  </div>
                </div>

                <div className="wsm-tip-card">
                  <div className="wsm-tip-header">
                    <div className="wsm-tip-icon-wrap">
                      <CheckCircle2 size={18} />
                    </div>
                    <h4 className="wsm-tip-title">Bulk Apply</h4>
                  </div>
                  <div className="wsm-tip-content">
                    <p className="wsm-tip-desc">
                      Apply your tweaks instantly to all generated images using the
                      "Bulk Apply" menu in the toolbar.
                    </p>
                  </div>
                </div>

                <div className="wsm-tip-card">
                  <div className="wsm-tip-header">
                    <div className="wsm-tip-icon-wrap">
                      <ClipboardCopy size={18} />
                    </div>
                    <h4 className="wsm-tip-title">Quick Image Pasting</h4>
                  </div>
                  <div className="wsm-tip-content">
                    <p className="wsm-tip-desc">
                      Press <span className="wsm-key-hint">Ctrl</span> + <span className="wsm-key-hint">V</span> or{' '}
                      <span className="wsm-key-hint"><Command size={11} className="wsm-key-icon" /> Cmd</span> + <span className="wsm-key-hint">V</span> to 
                      immediately start a Single Image Edit session with your clipboard image.
                    </p>
                  </div>
                </div>

                <div className="wsm-tip-card wsm-github-card">
                  <div className="wsm-tip-header">
                    <div className="wsm-tip-icon-wrap" style={{ background: 'rgba(255, 255, 255, 0.05)', color: '#fff', borderColor: 'rgba(255, 255, 255, 0.1)' }}>
                      <Github size={18} />
                    </div>
                    <h4 className="wsm-tip-title">Support & Feedback</h4>
                  </div>
                  <div className="wsm-tip-content">
                    <p className="wsm-tip-desc" style={{ marginBottom: '8px' }}>
                      Encountered an error? Copy the <b>Engine Streams</b> logs and report it on GitHub.
                    </p>
                    <button 
                      type="button"
                      onClick={() => invoke('open_external_url', { url: 'https://github.com/supSugam/beautiful-batches/issues' })}
                      className="wsm-github-link"
                    >
                      Report Issue or Request Feature
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.section>
    </div>
  );
};

export default WatermarkSettingsModal;
