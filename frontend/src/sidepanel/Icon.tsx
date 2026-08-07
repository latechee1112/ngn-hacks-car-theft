// Inline SVG icon set. lucide-react isn't a dependency of this project, so
// these are hand-authored in the same style: 24x24 box, stroked paths, no
// fills, so a single stroke width and size read consistently everywhere.
// Every icon renders at 16px — do not size these per-instance.

const PATHS = {
  // Brand mark: a funnel, for "distill".
  funnel: ['M22 3H2l8 9.5V19l4 2v-8.5L22 3Z'],
  layers: ['M12 3 3 7.5l9 4.5 9-4.5L12 3Z', 'm3 16.5 9 4.5 9-4.5', 'm3 12 9 4.5 9-4.5'],
  restore: ['M3 12a9 9 0 1 0 2.6-6.4L3 8', 'M3 3v5h5'],
  sliders: ['M21 5h-7', 'M10 5H3', 'M21 12h-9', 'M8 12H3', 'M21 19h-5', 'M12 19H3', 'M14 3v4', 'M8 10v4', 'M16 17v4'],
  user: ['M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2', 'M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8Z'],
  pulse: ['M22 12h-4l-3 8-6-16-3 8H2'],
  spacing: ['M3 4h18', 'M3 20h18', 'M12 8v8', 'm9 11 3-3 3 3', 'm9 13 3 3 3-3'],
  eye: ['M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z', 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z'],
  droplet: ['M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5S12.5 4 12 2c-.5 2-2 4.9-4 6.5S5 13 5 15a7 7 0 0 0 7 7Z'],
  expand: ['M8 3H5a2 2 0 0 0-2 2v3', 'M21 8V5a2 2 0 0 0-2-2h-3', 'M3 16v3a2 2 0 0 0 2 2h3', 'M16 21h3a2 2 0 0 0 2-2v-3'],
} as const

export type IconName = keyof typeof PATHS

function Icon({ name, className = '' }: { name: IconName; className?: string }) {
  return (
    <svg
      className={`h-4 w-4 shrink-0 ${className}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  )
}

export default Icon
