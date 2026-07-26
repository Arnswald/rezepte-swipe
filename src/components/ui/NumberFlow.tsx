"use client";

/**
 * NumberFlow — animiert eine Zahl weich von ihrem alten auf den neuen Wert.
 * Inspiriert von SmoothUI "Number Flow". Nutzt framer-motion (kein neues Paket).
 *
 * Beim Kartenwechsel rollen z.B. die Kalorien 492 → 380 durch, statt hart
 * umzuspringen. Respektiert prefers-reduced-motion.
 */

import { useEffect } from "react";
import { animate, useMotionValue, useTransform, motion, useReducedMotion } from "framer-motion";

export function NumberFlow({
  value,
  className,
  format = (n) => String(n),
  duration = 0.5,
}: {
  value: number;
  className?: string;
  format?: (n: number) => string;
  duration?: number;
}) {
  const prefersReduced = useReducedMotion();
  const mv = useMotionValue(value);
  const text = useTransform(mv, (v) => format(Math.round(v)));

  useEffect(() => {
    if (prefersReduced) {
      mv.set(value);
      return;
    }
    const controls = animate(mv, value, { duration, ease: "easeOut" });
    return () => controls.stop();
  }, [value, prefersReduced, duration, mv]);

  return <motion.span className={className}>{text}</motion.span>;
}
