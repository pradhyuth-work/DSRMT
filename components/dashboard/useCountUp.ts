"use client";

import { useEffect, useRef, useState } from "react";
import { formatMoney } from "@/lib/money";

/**
 * Animates a StatCard's value when it changes: "₹1,28,059.80" or "12" counts from the
 * previous figure to the new one in ~700ms. Anything that is not a plain money or whole-number
 * string (e.g. "—") is returned untouched. The final frame is always exactly the original
 * string, so what finally shows is never rounded or reformatted.
 */
export function useCountUp(value: string): string {
  const [shown, setShown] = useState(value);
  const prev = useRef<number | null>(null);
  useEffect(() => {
    const m = /^(-?)(₹?)([\d,]+(?:\.\d+)?)$/.exec(value.trim());
    const reduce = typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!m || reduce) {
      prev.current = null;
      setShown(value);
      return;
    }
    const to = (m[1] ? -1 : 1) * parseFloat(m[3].replace(/,/g, ""));
    const from = prev.current ?? 0;
    prev.current = to;
    if (from === to) {
      setShown(value);
      return;
    }
    const money = m[2] === "₹";
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / 700);
      const n = from + (to - from) * (1 - Math.pow(1 - p, 3));
      setShown(p >= 1 ? value : money ? formatMoney(n) : Math.round(n).toLocaleString("en-IN"));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return shown;
}
