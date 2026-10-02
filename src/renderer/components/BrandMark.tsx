import { cn } from "~/lib/utils"

const SPOKES = [0, 120, 240]

/**
 * The TenuVault mark: a vault door with hinges on the left and a coral three spoke wheel handle.
 * Same geometry as build/icon.png (scripts/render-icon.py), in its 1024 unit space. The door follows
 * the foreground colour, so it is charcoal in the light theme and cream in the dark theme.
 */
export function BrandMark({ className, title }: { className?: string; title?: string }) {
  return (
    <svg
      viewBox="178 178 668 668"
      className={cn("size-10 flex-shrink-0 text-foreground", className)}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <g fill="currentColor" fillRule="evenodd">
        <path d="M212 512a300 300 0 1 0 600 0a300 300 0 1 0 -600 0ZM274 512a238 238 0 1 0 476 0a238 238 0 1 0 -476 0Z" />
        <rect x="178" y="392" width="70" height="70" rx="18" />
        <rect x="178" y="562" width="70" height="70" rx="18" />
        <path
          opacity="0.14"
          d="M300 512a212 212 0 1 0 424 0a212 212 0 1 0 -424 0ZM316 512a196 196 0 1 0 392 0a196 196 0 1 0 -392 0Z"
        />
      </g>
      <g className="text-coral-500" fill="currentColor">
        {SPOKES.map((angle) => (
          <g key={angle} transform={`rotate(${angle} 512 512)`}>
            <rect x="490" y="362" width="44" height="90" />
            <circle cx="512" cy="362" r="36" />
          </g>
        ))}
        <path fillRule="evenodd" d="M434 512a78 78 0 1 0 156 0a78 78 0 1 0 -156 0ZM486 512a26 26 0 1 0 52 0a26 26 0 1 0 -52 0Z" />
      </g>
    </svg>
  )
}
