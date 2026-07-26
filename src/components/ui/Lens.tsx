"use client";

/**
 * Lens — Lupe die dem Finger/Cursor folgt und einen Bildausschnitt vergrößert.
 * Inspiriert von Magic UI "Lens". Bei Essen appetitlich: man sieht die Textur.
 *
 * Touch-freundlich: aktiviert sich bei touchstart und folgt dem Finger,
 * verschwindet bei touchend. Auf Desktop bei Hover.
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
  }, []);

  if (!src) {
    return <div className={className}>{children}</div>;
  }

  return (
    <div
      ref={containerRef}
      className={`relative overflow-hidden ${className ?? ""}`}
      onMouseEnter={() => setActive(true)}
      onMouseLeave={() => setActive(false)}
      onMouseMove={(e) => updateFromPoint(e.clientX, e.clientY)}
      onTouchStart={(e) => { setActive(true); const t = e.touches[0]; updateFromPoint(t.clientX, t.clientY); }}
      onTouchMove={(e) => { const t = e.touches[0]; updateFromPoint(t.clientX, t.clientY); }}
      onTouchEnd={() => setActive(false)}
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
            backgroundSize: `${(containerRef.current?.offsetWidth ?? 0) * zoom}px ${(containerRef.current?.offsetHeight ?? 0) * zoom}px`,
            backgroundPosition: `${-(pos.x * zoom - lensSize / 2)}px ${-(pos.y * zoom - lensSize / 2)}px`,
          }}
        />
      )}
    </div>
  );
}
