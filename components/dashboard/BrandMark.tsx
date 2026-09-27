/** The Varasidhi V + receipt glyph, line-art only with a transparent background (extracted
 * from the actual designed asset, public/brand-mark.png). Render inside a themed container —
 * bg-sidebar-primary in the sidebar (matching the active-nav lime), bg-primary elsewhere —
 * same pattern the old lucide icon used, just with the real glyph instead. */
export function BrandMark({ size = 18, className }: { size?: number; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/brand-glyph.png" width={size} height={size} alt="" draggable={false} className={className} />;
}
