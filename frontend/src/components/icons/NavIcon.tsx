/* ============================================================
   src/components/icons/NavIcon.tsx
   Reusable inline SVG icon from a path string.
   Used by Sidebar and PlaceholderPage.
   ============================================================ */

interface NavIconProps {
  path: string
  size?: number
  className?: string
}

export function NavIcon({ path, size = 18, className }: NavIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path d={path} />
    </svg>
  )
}
