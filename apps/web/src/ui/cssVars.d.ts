// Custom properties in `style` (ring and gauge values drive CSS animations through
// `--to`/`--v`): typed once here instead of casting at every use.
import 'react';

declare module 'react' {
  interface CSSProperties {
    [name: `--${string}`]: string | number | undefined;
  }
}
