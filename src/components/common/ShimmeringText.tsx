"use client"

import React, { useMemo, useRef } from "react"
import { motion, useInView, UseInViewOptions } from "framer-motion"
import "./ShimmeringText.css"

interface ShimmeringTextProps {
  /** Text to display with shimmer effect */
  text: string
  /** Animation duration in seconds */
  duration?: number
  /** Delay before starting animation */
  delay?: number
  /** Whether to repeat the animation */
  repeat?: boolean
  /** Pause duration between repeats in seconds */
  repeatDelay?: number
  /** Custom className */
  className?: string
  /** Whether to start animation when component enters viewport */
  startOnView?: boolean
  /** Whether to animate only once */
  once?: boolean
  /** Margin for in-view detection (rootMargin) */
  inViewMargin?: UseInViewOptions["margin"]
  /** Shimmer spread multiplier */
  spread?: number
  /** Base text color */
  color?: string
  /** Shimmer gradient color */
  shimmerColor?: string
}

export function ShimmeringText({
  text,
  duration = 2,
  delay = 0,
  repeat = true,
  repeatDelay = 0.5,
  className = "",
  startOnView = true,
  once = false,
  inViewMargin,
  spread = 2,
  color,
  shimmerColor,
}: ShimmeringTextProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const isInView = useInView(ref, { once, margin: inViewMargin as any })

  // Calculate dynamic spread based on text length
  const dynamicSpread = useMemo(() => {
    return text.length * spread
  }, [text, spread])

  // Determine if we should start animation
  const shouldAnimate = !startOnView || isInView

  return (
    <motion.span
      ref={ref}
      className={`shimmering-text ${className}`}
      style={
        {
          "--spread": `${dynamicSpread}px`,
          ...(color && { "--base-color": color }),
          ...(shimmerColor && { "--shimmer-color": shimmerColor }),
          backgroundImage: `var(--shimmer-bg), linear-gradient(var(--base-color, var(--muted-foreground)), var(--base-color, var(--muted-foreground)))`,
        } as React.CSSProperties
      }
      initial={{
        backgroundPosition: "100% center",
        opacity: 0,
      }}
      animate={
        shouldAnimate
          ? {
              backgroundPosition: "0% center",
              opacity: 1,
            }
          : {}
      }
      transition={{
        backgroundPosition: {
          repeat: repeat ? Infinity : 0,
          duration,
          delay,
          repeatDelay,
          ease: "linear",
        },
        opacity: {
          duration: 0.3,
          delay,
        },
      }}
    >
      {text}
    </motion.span>
  )
}

export default ShimmeringText;
