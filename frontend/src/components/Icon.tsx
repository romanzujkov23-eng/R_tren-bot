import type { SVGProps } from 'react'

const paths: Record<string, JSX.Element> = {
  home: <path d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  plan: (
    <>
      <rect x="5" y="4" width="14" height="17" rx="3" />
      <path d="M9 4.5h6M9 11h6M9 15h4" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15.5" rx="3" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
    </>
  ),
  chart: <path d="M5 20V11M12 20V4M19 20v-6M3 20.5h18" />,
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  left: <path d="m15 5-7 7 7 7" />,
  right: <path d="m9 5 7 7-7 7" />,
  down: <path d="m5 9 7 7 7-7" />,
  up: <path d="m5 15 7-7 7 7" />,
  plus: <path d="M12 5v14M5 12h14" />,
  x: <path d="m6 6 12 12M18 6 6 18" />,
  trash: <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16z" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </>
  ),
  play: <path d="M7 4.5v15l12-7.5z" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  dumbbell: <path d="M6.5 7v10M17.5 7v10M3.5 9.5v5M20.5 9.5v5M6.5 12h11" />,
  flame: <path d="M12 3c.6 3 4.6 4.8 4.6 9.6a4.6 4.6 0 0 1-9.2 0c0-1.8.9-3 2-3.9.1 1.7.9 2.6 1.8 2.9C11 8.7 10.7 6 12 3Z" />,
  book: (
    <>
      <path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z" />
      <path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19v-3" />
    </>
  ),
  target: (
    <>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2.5" />
      <path d="M16 8V6.5A2.5 2.5 0 0 0 13.5 4h-7A2.5 2.5 0 0 0 4 6.5v7A2.5 2.5 0 0 0 6.5 16H8" />
    </>
  ),
  undo: <path d="M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" />,
  pulse: <path d="M3 12h4l2.5-6 4 12 2.5-6H21" />,
  run: (
    <>
      <circle cx="15" cy="4.5" r="1.8" />
      <path d="m12.5 9.5 3.5 2 2.5-1.5M12.5 9.5 9 13l3.5 2.5-1 5M9 13l-4-1M16 11.5l-1.5 4.5 3.5 3.5" />
    </>
  ),
  walk: (
    <>
      <circle cx="13" cy="4.5" r="1.8" />
      <path d="m12 8.5-1.5 5.5 3 3V21M12 8.5l3 3.5h3M10.5 14l-3 1.5M13.5 17l1.5 4" />
    </>
  ),
  bike: (
    <>
      <circle cx="6" cy="16" r="3.5" />
      <circle cx="18" cy="16" r="3.5" />
      <path d="m6 16 4-8h5l3 8M10 8l2.5 8M13 5h3" />
    </>
  ),
  swim: (
    <>
      <circle cx="16" cy="6" r="1.8" />
      <path d="M7 12.5 12 9l3 2.5 3-1M3 16c2 0 2 1.5 4.5 1.5S10 16 12 16s2.5 1.5 4.5 1.5S19 16 21 16M3 20c2 0 2 1.5 4.5 1.5S10 20 12 20s2.5 1.5 4.5 1.5S19 20 21 20" />
    </>
  ),
  row: <path d="M3 15h18l-2.5 4h-13zM7 4l9 9M14 6l4 4" />,
  bolt: <path d="M13 3 5 13.5h6L10 21l8-10.5h-6z" />,
  lotus: (
    <>
      <circle cx="12" cy="5" r="1.8" />
      <path d="M6 11l6 2 6-2M12 8v8M5 19c3-1 5-2.5 7-2.5s4 1.5 7 2.5" />
    </>
  ),
  stretch: (
    <>
      <circle cx="12" cy="4.5" r="1.8" />
      <path d="M6 3l3 7M18 3l-3 7M9 10h6M12 10v5M12 15l-3 6M12 15l3 6" />
    </>
  ),
  ring: <ellipse cx="12" cy="12" rx="9" ry="4.5" transform="rotate(-35 12 12)" />,
  joint: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
    </>
  ),
  person: (
    <>
      <circle cx="12" cy="5" r="2" />
      <path d="M5 10h14M12 8v6M12 14l-3.5 7M12 14l3.5 7" />
    </>
  ),
  shirt: <path d="M8 3h8l3 4v5h-3v9H8v-9H5V7z" />,
  legs: <path d="M8 3h8l1 18h-3.5L12 11l-1.5 10H7z" />,
  grid: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.5" />
      <rect x="13" y="4" width="7" height="7" rx="1.5" />
      <rect x="4" y="13" width="7" height="7" rx="1.5" />
      <rect x="13" y="13" width="7" height="7" rx="1.5" />
    </>
  ),
  repeat: <path d="M4 11a8 8 0 0 1 14-4l2 2M20 4v5h-5M20 13a8 8 0 0 1-14 4l-2-2M4 20v-5h5" />,
  bar: (
    <>
      <path d="M3 4h18M8 4v4M16 4v4" />
      <circle cx="12" cy="11" r="2" />
      <path d="M12 13v4M12 17l-2 4M12 17l2 4" />
    </>
  ),
  ball: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3v18M3.5 9c4 1 13 1 17 0M3.5 15c4-1 13-1 17 0" />
    </>
  ),
  football: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m12 8.5 3 2.2-1.1 3.5h-3.8L9 10.7zM12 8.5V3M15 10.7l5.5-1.5M13.9 14.2l3.4 4.7M10.1 14.2l-3.4 4.7M9 10.7 3.5 9.2" />
    </>
  ),
  basketball: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3v18M3 12h18M5.6 5.6c3 3 3 9.8 0 12.8M18.4 5.6c-3 3-3 9.8 0 12.8" />
    </>
  ),
  volleyball: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3c0 5 3 8 8.5 9M12 3C9 3.5 6 5.5 4.5 9M3.5 14c4.5-1 7.5 1 8.5 7M20.5 12c-1 4-4 7-8.5 9" />
    </>
  ),
  tennis: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M5.5 5.5c4 3 4 10 0 13M18.5 5.5c-4 3-4 10 0 13" />
    </>
  ),
  glove: <path d="M7 11V8a4 4 0 0 1 4-4h3a4 4 0 0 1 4 4v4a6 6 0 0 1-6 6h-1l-1 3H7zM7 14h4" />,
  hockey: (
    <>
      <path d="m6 3 8 15h5" />
      <ellipse cx="9" cy="20" rx="3.5" ry="1.4" />
    </>
  ),
  snow: <path d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9M9.5 4.5 12 6.5l2.5-2M9.5 19.5l2.5-2 2.5 2" />,
  medal: (
    <>
      <circle cx="12" cy="15" r="5" />
      <path d="M8 3.5 10.5 10M16 3.5 13.5 10" />
    </>
  ),
  checkcircle: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12.5 3 3 5-6" />
    </>
  ),
  music: (
    <>
      <path d="M9 18V6l10-2v12" />
      <circle cx="7" cy="18" r="2" />
      <circle cx="17" cy="16" r="2" />
    </>
  ),
  mountain: <path d="m3 19 6-10 4 6 2.5-4L21 19z" />,
  scale: <path d="M12 4v16M6 20h12M5 7h14M5 7l-2.5 6a3 3 0 0 0 5 0zM19 7l-2.5 6a3 3 0 0 0 5 0z" />,
  face1: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m7.5 8.5 3 1M16.5 8.5l-3 1M8.5 16.5c1-1.6 2.2-2.3 3.5-2.3s2.5.7 3.5 2.3" />
    </>
  ),
  face2: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 10h.01M15 10h.01M9 15.5c1.5-.8 4-.8 6 .3" />
    </>
  ),
  face3: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 10h.01M15 10h.01M9 15h6" />
    </>
  ),
  face4: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M9 10h.01M15 10h.01M8.5 14c1 1.6 2.2 2.3 3.5 2.3s2.5-.7 3.5-2.3" />
    </>
  ),
}

export default function Icon({ name, size = 22, ...rest }: { name: keyof typeof paths | string; size?: number } & SVGProps<SVGSVGElement>) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {paths[name]}
    </svg>
  )
}
