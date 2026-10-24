/** The Varasidhi V + receipt glyph, line-art only with a transparent background (extracted
 * from the actual designed asset, public/brand-mark.png). Render inside a themed container —
 * bg-sidebar-primary in the sidebar (matching the active-nav lime), bg-primary elsewhere —
 * same pattern the old lucide icon used, just with the real glyph instead.
 *
 * `tone="dark"` swaps in a navy-lined variant: white line-art has almost no contrast on the
 * sidebar's lime, so that context needs the dark version instead. */
export function BrandMark({ size = 18, tone = "light", className }: { size?: number; tone?: "light" | "dark"; className?: string }) {
  const src = tone === "dark" ? "/brand-glyph-dark.png" : "/brand-glyph.png";
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} width={size} height={size} alt="" draggable={false} className={className} />;
}

/** The full Varasidhi app tile (dark rounded square with the V + receipt). Use instead of
 * BrandMark inside a coloured container. */
export function BrandTile({ size = 36, className = "" }: { size?: number; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/brand-mark.png" width={size} height={size} alt="" draggable={false} className={`brand-tile ${className}`} />;
}
