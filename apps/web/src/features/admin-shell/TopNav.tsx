import { Link, NavLink } from 'react-router';
import { IconButton } from '../../ui/IconButton.tsx';
import { Icon } from '../../ui/Icon.tsx';
import { iconButtonClass } from '../../ui/iconButtonClass.ts';
import styles from './AdminLayout.module.css';
import { LiveIndicator } from './LiveIndicator.tsx';
import { ADMIN_PAGES } from './pages.ts';

export function TopNav({ onSearch }: { onSearch: () => void }) {
  return (
    <header className={styles.top}>
      <Link to="/admin" className={styles.logo} viewTransition>
        <Icon name="filter" className={styles.logoIcon} />
        <b>funnel</b>
        <span>runtime</span>
      </Link>
      <nav className={styles.tabs} aria-label="Admin">
        {ADMIN_PAGES.map((page) => (
          <NavLink key={page.to} to={page.to} end={page.end} viewTransition>
            {page.label}
          </NavLink>
        ))}
        <a href="/" target="_blank" rel="noopener">
          Open funnel
        </a>
      </nav>
      <div className={styles.right}>
        <LiveIndicator />
        <IconButton icon="search" aria-label="Search and commands (Command K)" onClick={onSearch} />
        <Link
          to="/admin/live?status=rejected"
          className={iconButtonClass()}
          aria-label="Rejected events"
        >
          <Icon name="bell" />
        </Link>
        <span className={styles.me} role="img" aria-label="Signed in as admin">
          AD
        </span>
      </div>
    </header>
  );
}
