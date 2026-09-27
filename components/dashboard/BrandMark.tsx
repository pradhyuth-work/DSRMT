/** The V + receipt monogram used as the app's brand mark (login screen, sidebar, mobile
 * header, favicon). Uses `currentColor` so it inherits whatever theme color its container
 * applies, same as the lucide icon it replaced. */
export function BrandMark({ size = 18, strokeWidth = 1.8, className }: { size?: number; strokeWidth?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M3 4.5 8 15 11.5 6.5" />
      <path d="M11.5 4v16l1.6-1 1.6 1 1.6-1 1.6 1 1.6-1 1.6 1V4l-1.6 1-1.6-1-1.6 1-1.6-1-1.6 1-1.6-1Z" />
      <path d="M15 9h4" />
      <path d="M15 12h4" />
      <path d="M15 15h3" />
    </svg>
  );
}
