"use client"

import { cn } from "~/lib/utils"

interface GradientOrbProps {
  size?: "sm" | "md" | "lg" | "xl"
  gradient: string
  position?: string
  animate?: boolean
  opacity?: number
  blur?: boolean
  className?: string
}

const sizeClasses = {
  sm: "w-32 h-32",
  md: "w-48 h-48",
  lg: "w-64 h-64",
  xl: "w-80 h-80"
}

export function GradientOrb({
  size = "md",
  gradient,
  position = "",
  animate = true,
  opacity = 20,
  blur = true,
  className
}: GradientOrbProps) {
  return (
    <div
      className={cn(
        "absolute rounded-full",
        sizeClasses[size],
        `bg-gradient-to-br ${gradient}`,
        position,
        blur && "blur-3xl",
        animate && "animate-float",
        className
      )}
      style={{
        opacity: opacity / 100,
        animation: animate ? `float ${size === 'sm' ? '15s' : size === 'md' ? '20s' : size === 'lg' ? '25s' : '30s'} ease-in-out infinite` : undefined
      }}
    />
  )
}

// Add custom float animation to global CSS
if (typeof window !== 'undefined') {
  const style = document.createElement('style')
  style.textContent = `
    @keyframes float {
      0%, 100% { transform: translate(0, 0) scale(1); }
      25% { transform: translate(-10px, -20px) scale(1.05); }
      50% { transform: translate(10px, -10px) scale(0.95); }
      75% { transform: translate(-5px, 10px) scale(1.02); }
    }
    .animate-float {
      animation: float 20s ease-in-out infinite;
    }
  `
  document.head.appendChild(style)
}