"use client";

import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import "./TransitioningStatus.css";

interface TransitioningStatusProps {
  text: string;
}

export function TransitioningStatus({ text }: TransitioningStatusProps) {
  const [items, setItems] = useState<{ id: string; text: string }[]>([]);
  const lastProcessedText = useRef("");

  useEffect(() => {
    if (text && text !== lastProcessedText.current) {
      const newItem = { id: Math.random().toString(), text };
      setItems(prev => [...prev, newItem].slice(-2));
      lastProcessedText.current = text;
    }
  }, [text]);

  return (
    <div className="transitioning-status-container">
      <AnimatePresence mode="popLayout" initial={false}>
        {items.map((item, index) => {
          const isMain = index === items.length - 1;
          
          return (
            <motion.div
              key={item.id}
              layout
              initial={{ 
                opacity: 0, 
                y: 22, 
                scale: 1, 
              }}
              animate={{ 
                opacity: isMain ? 1 : 0.45, 
                y: isMain ? 0 : -12, 
                scale: isMain ? 1 : 0.9, 
              }}
              exit={{ 
                opacity: 0, 
                y: -30, 
                scale: 0.85,
              }}
              transition={{ 
                type: "spring",
                damping: 32, // More luxurious damping
                stiffness: 220,
              }}
              className={`transitioning-status-line ${
                isMain ? "status-line-main status-shimmer" : "status-line-prev"
              }`}
            >
              {item.text}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}

export default TransitioningStatus;
