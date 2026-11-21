"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

/**
 * Pointer-following magnifier/spotlight for dark walnut surfaces.
 * Mouse: follows pointer. Touch: tap-to-focus for 1.6s. Reduced motion: static pool.
 */
export function SpotlightSurface({
  children,
  className,
  lens = true,
}: {
  children: React.ReactNode;
  className?: string;
  lens?: boolean;
}) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const lensRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<number | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reduced = useReducedMotion();
  const [interactive, setInteractive] = useState(false);

  const applyPosition = useCallback((clientX: number, clientY: number, showLens: boolean) => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const rect = surface.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * 100;
    const y = ((clientY - rect.top) / rect.height) * 100;
    surface.style.setProperty("--spot-x", `${x}%`);
    surface.style.setProperty("--spot-y", `${y}%`);
    if (lens && lensRef.current) {
      lensRef.current.style.left = `${clientX}px`;
      lensRef.current.style.top = `${clientY}px`;
      lensRef.current.style.opacity = showLens ? "1" : "0";
    }
  }, [lens]);

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (reduced) return;
    if (event.pointerType === "touch") return;
    setInteractive(true);
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => applyPosition(event.clientX, event.clientY, true));
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (reduced) return;
    if (event.pointerType !== "touch" && event.pointerType !== "pen") return;
    setInteractive(false);
    applyPosition(event.clientX, event.clientY, false);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      const surface = surfaceRef.current;
      if (surface) {
        surface.style.setProperty("--spot-x", "60%");
        surface.style.setProperty("--spot-y", "42%");
      }
    }, 1700);
  };

  const onPointerLeave = () => {
    setInteractive(false);
    if (lensRef.current) lensRef.current.style.opacity = "0";
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
  };

  useEffect(() => {
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  return (
    <div
      ref={surfaceRef}
      className={cn("spotlight-surface", className)}
      onPointerMove={onPointerMove}
      onPointerDown={onPointerDown}
      onPointerLeave={onPointerLeave}
    >
      {children}
      {lens && !reduced ? (
        <div
          ref={lensRef}
          aria-hidden="true"
          className="magnifier-lens hidden opacity-0 transition-opacity duration-150 lg:block"
          style={{ display: interactive ? undefined : "none" }}
        >
          <span className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary/80" />
        </div>
      ) : null}
    </div>
  );
}
