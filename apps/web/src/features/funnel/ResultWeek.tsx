// "What a week could look like" (CLAUDE.md 8.3): a Mon–Fri × AM/PM grid colored by the
// result. This is a visual reading of the result, not content, so the mapping lives in
// code; a result id it does not know simply gets no grid.
import styles from './ResultScreen.module.css';

const SLOTS = ['office', 'focus', 'async', 'free'] as const;
type Slot = (typeof SLOTS)[number];

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] as const;
const HALVES = ['AM', 'PM'] as const;

const LEGEND: Readonly<Record<Slot, string>> = {
  office: 'Office, together',
  focus: 'Protected focus',
  async: 'Written updates',
  free: 'Open time',
};

/** Ten slots: Mon–Fri mornings, then Mon–Fri afternoons. */
const WEEKS: Readonly<Record<string, readonly Slot[]>> = {
  async_native: [
    'focus',
    'focus',
    'focus',
    'focus',
    'focus',
    'async',
    'async',
    'free',
    'async',
    'free',
  ],
  hybrid_structured: [
    'focus',
    'office',
    'focus',
    'office',
    'focus',
    'async',
    'office',
    'async',
    'office',
    'free',
  ],
  office_core: [
    'office',
    'office',
    'focus',
    'office',
    'office',
    'office',
    'focus',
    'office',
    'office',
    'free',
  ],
  balanced: [
    'focus',
    'office',
    'focus',
    'async',
    'focus',
    'async',
    'office',
    'async',
    'free',
    'free',
  ],
};

export function ResultWeek({ resultId, title }: { resultId: string; title: string }) {
  const week = WEEKS[resultId];
  if (!week) return null;
  const used = SLOTS.filter((slot) => week.includes(slot));
  return (
    <section className={styles.week} aria-labelledby="week-title">
      <h2 className={styles.weekTitle} id="week-title">
        {title}
      </h2>
      <table className={styles.grid}>
        <thead>
          <tr>
            <td />
            {DAYS.map((day) => (
              <th key={day} scope="col">
                {day}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {HALVES.map((half, row) => (
            <tr key={half}>
              <th scope="row">{half}</th>
              {DAYS.map((day, col) => {
                const slot = week[row * DAYS.length + col] ?? 'free';
                return (
                  <td key={day}>
                    <span className={`${styles.cell} ${styles[slot] ?? ''}`}>
                      <span className={styles.srOnly}>{LEGEND[slot]}</span>
                    </span>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <ul className={styles.legend} aria-hidden="true">
        {used.map((slot) => (
          <li key={slot}>
            <i className={styles[slot]} />
            {LEGEND[slot]}
          </li>
        ))}
      </ul>
    </section>
  );
}
