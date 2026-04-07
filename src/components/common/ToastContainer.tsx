import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlertCircle, CheckCircle, Info, XCircle, X } from 'lucide-react';
import useStore from '../../store/useStore';
import './ToastContainer.css';

const ToastIcon = ({ type }: { type: string }) => {
  switch (type) {
    case 'error':
      return <XCircle size={18} className="toast-icon error" />;
    case 'success':
      return <CheckCircle size={18} className="toast-icon success" />;
    case 'warning':
      return <AlertCircle size={18} className="toast-icon warning" />;
    default:
      return <Info size={18} className="toast-icon info" />;
  }
};

const ToastContainer = () => {
  const toasts = useStore((state) => state.toasts);
  const removeToast = useStore((state) => state.removeToast);

  return (
    <div className="toast-container">
      <AnimatePresence>
        {toasts.map((toast) => (
          <motion.div
            key={toast.id}
            layout
            initial={{ opacity: 0, x: -30, scale: 0.95 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            exit={{ opacity: 0, x: -20, scale: 0.95, transition: { duration: 0.2 } }}
            className={`toast-item ${toast.type}`}
          >
            <div className="toast-content">
              <ToastIcon type={toast.type} />
              <span className="toast-message">{toast.message}</span>
            </div>
            <button
              type="button"
              className="toast-close-btn"
              onClick={() => removeToast(toast.id)}
            >
              <X size={14} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
};

export default ToastContainer;
