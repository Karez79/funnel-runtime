// Admin shell (CLAUDE.md 10, 11.1): sticky frosted top bar with text tabs (the active one
// a black pill), round search / notifications / avatar buttons, a rail of round buttons
// on the left (hidden on mobile) and the ⌘K command palette. Pages render in <Outlet>;
// they are separate features and never import the shell.
import { useEffect, useState } from 'react';
import { Outlet } from 'react-router';
import { CommandPalette } from '../../ui/CommandPalette.tsx';
import styles from './AdminLayout.module.css';
import { usePaletteCommands } from './commands.ts';
import { Rail } from './Rail.tsx';
import { TopNav } from './TopNav.tsx';

export function AdminLayout() {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const commands = usePaletteCommands();
  const openPalette = () => {
    setPaletteOpen(true);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <div className={styles.app}>
      <TopNav onSearch={openPalette} />
      <Rail onSearch={openPalette} />
      <main className={styles.main}>
        <Outlet />
      </main>
      <CommandPalette
        open={paletteOpen}
        onClose={() => {
          setPaletteOpen(false);
        }}
        commands={commands}
        placeholder="Command or session id"
      />
    </div>
  );
}
