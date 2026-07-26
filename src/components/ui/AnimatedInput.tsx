"use client";

/**
 * AnimatedInput — Textfeld mit schwebendem Label und animiertem Fokus-Rahmen.
 * Inspiriert von SmoothUI "Animated Input". Das Label wandert beim Fokus/Inhalt
 * nach oben, der Rahmen bekommt einen weichen Akzent-Glow.
 */

import { useId, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

export function AnimatedInput({
  label,
  value,
  onChange,
  type = "text",
  icon: Icon,
  className,
  inputMode,
  autoFocus,
  onKeyDown,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  icon?: React.ComponentType<{ className?: string }>;
  className?: string;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  autoFocus?: boolean;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  const id = useId();
  const [focused, setFocused] = useState(false);
  const prefersReduced = useReducedMotion();
  const floated = focused || value.length > 0;

  return (
    <div className={cn("relative", className)}>
      {Icon && (
        <Icon className={cn(
          "absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 transition-colors z-10",
          focused ? "text-accent" : "text-text-muted",
        )} />
      )}
      <input
        id={id}
        type={type}
        value={value}
        inputMode={inputMode}
        autoFocus={autoFocus}
        onKeyDown={onKeyDown}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        placeholder=" "
        className={cn(
          "peer w-full bg-surface border rounded-xl text-sm text-text-primary outline-none transition-colors",
          Icon ? "pl-9 pr-3" : "px-3",
          "pt-5 pb-1.5",
          focused ? "border-accent" : "border-border",
        )}
      />
      <label
        htmlFor={id}
        className={cn(
          "absolute pointer-events-none transition-all duration-200 text-text-muted",
          Icon ? "left-9" : "left-3",
          floated ? "top-1.5 text-[10px] font-medium" : "top-1/2 -translate-y-1/2 text-sm",
          focused && "text-accent",
        )}
      >
        {label}
      </label>
      {/* Animierter Fokus-Unterstrich */}
      <motion.span
        className="absolute bottom-0 left-3 right-3 h-[2px] rounded-full bg-accent origin-center"
        initial={false}
        animate={{ scaleX: focused ? 1 : 0, opacity: focused ? 1 : 0 }}
        transition={prefersReduced ? { duration: 0 } : { type: "spring", stiffness: 400, damping: 32 }}
      />
    </div>
  );
}
