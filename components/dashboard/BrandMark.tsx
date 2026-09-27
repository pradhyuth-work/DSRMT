/** The Varasidhi brand mark — the actual designed asset (public/brand-mark.png), not a
 * redrawn icon, so it always matches exactly. Its rounded-square background and corner
 * rounding are baked into the image itself; render it directly with no wrapper container. */
export function BrandMark({ size = 36, className }: { size?: number; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/brand-mark.png" width={size} height={size} alt="" draggable={false} className={className} />;
}
