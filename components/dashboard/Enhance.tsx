"use client";

import { useEffect } from "react";

/**
 * Mounts once and adds one passive behaviour: a soft lime spotlight that follows the pointer
 * over any .card (only on devices that really hover). It reads nothing, writes no data and
 * touches no React-managed content: it only sets two CSS variables on the card under the
 * pointer. Everything else in the enhancement is plain CSS (app/enhance.css).
 */
export default function Enhance() {
  useEffect(() => {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const onMove = (e: PointerEvent) => {
      const el = (e.target as HTMLElement | null)?.closest?.<HTMLElement>(".card");
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty("--mx", `${e.clientX - r.left}px`);
      el.style.setProperty("--my", `${e.clientY - r.top}px`);
      el.classList.add("is-spot");
    };
    document.addEventListener("pointermove", onMove, { passive: true });
    return () => document.removeEventListener("pointermove", onMove);
  }, []);
  return null;
}
