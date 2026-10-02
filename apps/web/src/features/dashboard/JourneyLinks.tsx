// Curved connectors between journey columns (CLAUDE.md 10): an SVG layer over the
// journey with cubic curves from the middle of a column's right edge to every node of
// the next column, small ports at the ends, a coral dashed curve into the biggest-drop
// step and an arrow into the "Reached result" tile. Coordinates come from real
// getBoundingClientRect values and are redrawn by a ResizeObserver.
import { useEffect, useState, type RefObject } from 'react';
import styles from './Journey.module.css';

interface Link {
  readonly d: string;
  readonly kind: 'plain' | 'hot' | 'arrow';
  readonly port: { x: number; y: number } | null;
}

interface Drawing {
  readonly width: number;
  readonly height: number;
  readonly links: readonly Link[];
  readonly sources: readonly { x: number; y: number }[];
}

const EMPTY: Drawing = { width: 0, height: 0, links: [], sources: [] };

function measure(root: HTMLElement): Drawing {
  const box = root.getBoundingClientRect();
  const ox = root.scrollLeft - box.left;
  const oy = root.scrollTop - box.top;
  const columns = [...root.querySelectorAll<HTMLElement>('[data-journey-col]')];
  const links: Link[] = [];
  const sources: { x: number; y: number }[] = [];
  for (let i = 0; i < columns.length - 1; i += 1) {
    const from = columns[i]?.querySelector('[data-journey-box]')?.getBoundingClientRect();
    const next = columns[i + 1];
    if (!from || !next) continue;
    const x1 = from.right + ox;
    const y1 = from.top + from.height / 2 + oy;
    const targets = [...next.querySelectorAll<HTMLElement>('[data-journey-target]')];
    const edgeBox = next.querySelector('[data-journey-box]') ?? targets[0];
    if (!edgeBox) continue;
    const x2 = edgeBox.getBoundingClientRect().left + ox;
    for (const target of targets) {
      const r = target.getBoundingClientRect();
      const y2 = r.top + r.height / 2 + oy;
      const mx = (x1 + x2) / 2;
      const kind =
        target.dataset.journeyTarget === 'result'
          ? 'arrow'
          : target.dataset.hot === 'true'
            ? 'hot'
            : 'plain';
      const end = kind === 'arrow' ? x2 - 4 : x2;
      links.push({
        d: `M${String(x1)} ${String(y1)} C${String(mx)} ${String(y1)}, ${String(mx)} ${String(y2)}, ${String(end)} ${String(y2)}`,
        kind,
        port: kind === 'arrow' ? null : { x: x2, y: y2 },
      });
      if (kind === 'arrow') {
        links.push({
          d: `M${String(x2 - 9)} ${String(y2 - 4)} L${String(x2 - 3)} ${String(y2)} L${String(x2 - 9)} ${String(y2 + 4)}`,
          kind,
          port: null,
        });
      }
    }
    sources.push({ x: x1, y: y1 });
  }
  return { width: root.scrollWidth, height: root.scrollHeight, links, sources };
}

export function JourneyLinks({
  root,
  version,
}: {
  root: RefObject<HTMLElement | null>;
  /** Changes whenever the drawn content changes, so the curves are measured again. */
  version: string;
}) {
  const [drawing, setDrawing] = useState<Drawing>(EMPTY);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const draw = () => {
      setDrawing(measure(el));
    };
    const observer = new ResizeObserver(draw);
    observer.observe(el);
    for (const child of el.querySelectorAll('[data-journey-col]')) observer.observe(child);
    void document.fonts.ready.then(draw);
    return () => {
      observer.disconnect();
    };
  }, [root, version]);

  return (
    <svg
      className={styles.links}
      width={drawing.width}
      height={drawing.height}
      style={{ width: drawing.width, height: drawing.height }}
      aria-hidden="true"
    >
      {drawing.links.map((link, i) => (
        <g key={i}>
          <path d={link.d} className={link.kind === 'plain' ? undefined : styles[link.kind]} />
          {link.port && (
            <circle
              cx={link.port.x}
              cy={link.port.y}
              r={2.6}
              className={link.kind === 'hot' ? styles.hot : undefined}
            />
          )}
        </g>
      ))}
      {drawing.sources.map((s, i) => (
        <circle key={`s${String(i)}`} cx={s.x} cy={s.y} r={3} />
      ))}
    </svg>
  );
}
