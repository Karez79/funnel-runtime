// The icon set of the design reference (its <symbol>s), drawn as inline SVG so no sprite
// file or icon library is needed. Icons are decorative; the control that holds one
// carries the accessible name.
import styles from './Icon.module.css';

const PATHS = {
  chart: ['M4 20V10M10 20V4M16 20v-7M22 20H2'],
  layers: ['M12 3l9 5-9 5-9-5 9-5z', 'M3 13l9 5 9-5'],
  pulse: ['M3 12h4l3-8 4 16 3-8h4'],
  eye: ['M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z', 'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z'],
  search: ['M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0z', 'M20 20l-3.5-3.5'],
  upload: ['M12 15V4M7 9l5-5 5 5M4 15v4a1 1 0 001 1h14a1 1 0 001-1v-4'],
  calendar: [
    'M6 5h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z',
    'M4 10h16M9 3v4M15 3v4',
  ],
  filter: ['M4 5h16l-6 8v6l-4-2v-4z'],
  back: ['M15 6l-6 6 6 6'],
  gear: [
    'M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0z',
    'M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1',
  ],
  undo: ['M9 14L4 9l5-5', 'M4 9h10a6 6 0 010 12h-3'],
  pause: ['M8 5v14M16 5v14'],
  bell: ['M6 9a6 6 0 0112 0c0 6 2 7 2 7H4s2-1 2-7', 'M10 20a2 2 0 004 0'],
  help: [
    'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z',
    'M9.5 9.5a2.5 2.5 0 015 .5c0 2-2.5 2-2.5 4M12 17h.01',
  ],
  check: ['M6 12l4 4 8-8'],
  check2: ['M2 12l4 4 8-8M10 16l1 1 10-10'],
  plus: ['M12 5v14M5 12h14'],
  minus: ['M5 12h14'],
  arrow: ['M5 12h14M13 6l6 6-6 6'],
  close: ['M6 6l12 12M18 6L6 18'],
} as const satisfies Record<string, readonly string[]>;

export type IconName = keyof typeof PATHS;

export function Icon({ name, className }: { name: IconName; className?: string | undefined }) {
  return (
    <svg
      className={className ? `${styles.icon} ${className}` : styles.icon}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
