// ⌘K / Ctrl+K command palette (CLAUDE.md 10.1) on a modal <dialog>: a combobox input
// filters a grouped listbox, arrows move, Enter runs, Esc closes. It knows nothing about
// the app: the caller passes the commands, including ones derived from what is typed.
import { useEffect, useId, useRef, useState } from 'react';
import { Dialog } from './Dialog.tsx';
import { Icon, type IconName } from './Icon.tsx';
import styles from './CommandPalette.module.css';

export interface Command {
  readonly id: string;
  readonly group: string;
  readonly label: string;
  readonly icon: IconName;
  readonly hint?: string;
  /** Shown whatever is typed (a command built from the query itself). */
  readonly always?: boolean;
  readonly run: () => void;
}

export function CommandPalette({
  open,
  onClose,
  commands,
  placeholder,
}: {
  open: boolean;
  onClose: () => void;
  /** Called with the current query, so commands can depend on it (session search). */
  commands: (query: string) => readonly Command[];
  placeholder: string;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) input.current?.focus();
  }, [open]);

  const close = () => {
    setQuery('');
    setActive(0);
    onClose();
  };

  const q = query.trim().toLowerCase();
  const visible = commands(query.trim()).filter(
    (c) => c.always === true || c.label.toLowerCase().includes(q),
  );
  const current = Math.min(active, Math.max(0, visible.length - 1));

  const run = (command: Command | undefined) => {
    if (!command) return;
    close();
    command.run();
  };

  const groups = [...new Set(visible.map((c) => c.group))];
  const optionId = (c: Command) => `${listId}-${c.id}`;
  const activeCommand = visible[current];

  return (
    <Dialog open={open} onClose={close} className={styles.palette} aria-label="Search and commands">
      <div className={styles.input}>
        <Icon name="search" />
        <input
          ref={input}
          value={query}
          placeholder={placeholder}
          autoComplete="off"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={activeCommand ? optionId(activeCommand) : undefined}
          onChange={(e) => {
            setQuery(e.currentTarget.value);
            setActive(0);
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault();
              const step = e.key === 'ArrowDown' ? 1 : -1;
              setActive((current + step + visible.length) % Math.max(1, visible.length));
            }
            if (e.key === 'Enter') {
              e.preventDefault();
              run(activeCommand);
            }
          }}
        />
        <kbd className={styles.kbd}>Esc</kbd>
      </div>
      <ul className={styles.list} id={listId} role="listbox" aria-label="Commands">
        {groups.map((group) => (
          <li key={group} role="presentation">
            <div className={styles.group} aria-hidden="true">
              {group}
            </div>
            <ul role="group" aria-label={group} className={styles.sublist}>
              {visible
                .filter((c) => c.group === group)
                .map((c) => (
                  <li
                    key={c.id}
                    id={optionId(c)}
                    role="option"
                    aria-selected={c === activeCommand}
                    className={styles.option}
                    onMouseMove={() => {
                      setActive(visible.indexOf(c));
                    }}
                    onClick={() => {
                      run(c);
                    }}
                  >
                    <span className={styles.icon}>
                      <Icon name={c.icon} />
                    </span>
                    {c.label}
                    {c.hint && <span className={styles.hint}>{c.hint}</span>}
                  </li>
                ))}
            </ul>
          </li>
        ))}
      </ul>
      {visible.length === 0 && (
        <p className={styles.empty} role="status">
          Nothing matches “{query}”.
        </p>
      )}
      <div className={styles.foot}>
        <span>
          <kbd className={styles.kbd}>↑</kbd> <kbd className={styles.kbd}>↓</kbd> to move
        </span>
        <span>
          <kbd className={styles.kbd}>Enter</kbd> to open
        </span>
      </div>
    </Dialog>
  );
}
