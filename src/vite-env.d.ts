/// <reference types="vite/client" />
import 'react';

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

declare module 'react' {
  interface InputHTMLAttributes<T> {
    webkitdirectory?: string;
    directory?: string;
  }
}

export {};
