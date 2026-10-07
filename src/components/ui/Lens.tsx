"use client";

/**
 * Lens — Lupe die dem Finger/Cursor folgt und einen Bildausschnitt vergrößert.
 * Inspiriert von Magic UI "Lens". Bei Essen appetitlich: man sieht die Textur.
 *
 * Touch: aktiviert sich erst nach kurzem Halten (~250 ms ohne Bewegung) und folgt
 * dann dem Finger. Wer nur scrollt, bekommt keine Lupe (vorher sprang sie bei
 * jedem Scroll-Start im Detail-Sheet auf). Auf Desktop bei Hover.
 */

import { useRef, useState, useCallback } from "react";

export function Lens({
  src,
  alt,
  zoom = 2,
  lensSize = 140,
  className,
  children,
}: {
  src: string;
  alt?: string;
  zoom?: number;
  lensSize?: number;
  className?: string;
  /** Optionaler Fallback-Inhalt (z.B. Emoji-Platzhalter) statt des Bildes */
  children?: React.ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [size, setSize] = useState({ w: 0, h: 0 }); // Container-Größe (nicht aus dem Ref im Render lesen)
  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const activeRef = useRef(false);
  // iOS feuert nach einem Tipp emulierte Maus-Events (mouseenter ohne mouseleave) →
  // ohne Sperre bliebe die Lupe nach einem Tipp einfach stehen.
  const touchedAt = useRef(0);
  const fromTouch = () => Date.now() - touchedAt.current < 1000;
  const clearHold = () => { if (holdTimer.current) { clearTimeout(holdTimer.current); holdTimer.current = null; } };

  const updateFromPoint = useCallback((clientX: number, clientY: number) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
      setActive(false);
      return;
    }
    setPos({ x, y });
    setSize((s) => (s.w === rect.width && s.h === rect.height ? s : { w: rect.width, h: rect.height }));
  }, []);

  if (!src) {
    return <div className={className}>{children}</div>;
  }

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden ${className ?? ""}`}
      onMouseEnter={() => { if (!fromTouch()) setActive(true); }}
      onMouseLeave={() => { if (!fromTouch()) setActive(false); }}
      onMouseMove={(e) => { if (!fromTouch()) updateFromPoint(e.clientX, e.clientY); }}
      onTouchStart={(e) => {
        const t = e.touches[0];
        touchedAt.current = Date.now();
        touchStart.current = { x: t.clientX, y: t.clientY };
        clearHold();
        holdTimer.current = setTimeout(() => {
          activeRef.current = true; setActive(true);
          if (touchStart.current) updateFromPoint(touchStart.current.x, touchStart.current.y);
        }, 250);
      }}
      onTouchMove={(e) => {
        const t = e.touches[0];
        if (!activeRef.current) {
          const s0 = touchStart.current;
          if (s0 && Math.hypot(t.clientX - s0.x, t.clientY - s0.y) > 8) clearHold(); // Scrollen → keine Lupe
          return;
        }
        updateFromPoint(t.clientX, t.clientY);
      }}
      onTouchEnd={() => { touchedAt.current = Date.now(); clearHold(); activeRef.current = false; setActive(false); }}
      onTouchCancel={() => { clearHold(); activeRef.current = false; setActive(false); }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className="w-full h-full object-cover" draggable={false} />

      {active && (
        <div
          className="pointer-events-none absolute rounded-full border-2 border-white/70 shadow-xl z-10"
          style={{
            width: lensSize,
            height: lensSize,
            left: pos.x - lensSize / 2,
            top: pos.y - lensSize / 2,
            backgroundImage: `url(${src})`,
            backgroundRepeat: "no-repeat",
            backgroundSize: `${size.w * zoom}px ${size.h * zoom}px`,
            backgroundPosition: `${-(pos.x * zoom - lensSize / 2)}px ${-(pos.y * zoom - lensSize / 2)}px`,
          }}
        />
      )}
    </div>
  );
}
