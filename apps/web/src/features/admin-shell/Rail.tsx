import { Link, NavLink, useNavigate } from 'react-router';
import { Icon } from '../../ui/Icon.tsx';
import { IconButton } from '../../ui/IconButton.tsx';
import { cx } from '../../ui/cx.ts';
import { iconButtonClass } from '../../ui/iconButtonClass.ts';
import styles from './AdminLayout.module.css';
import { ADMIN_PAGES } from './pages.ts';

export function Rail({ onSearch }: { onSearch: () => void }) {
  const navigate = useNavigate();
  return (
    <aside className={styles.rail} aria-label="Sections">
      <IconButton
        icon="back"

        aria-label="Back"
        onClick={() => {
          void navigate(-1);
        }}
      />
      {ADMIN_PAGES.map((page) => (
        <NavLink
          key={page.to}
          to={page.to}
          end={page.end}
          viewTransition
          className={cx(iconButtonClass(), styles.railLink)}
          aria-label={page.label}
          title={page.label}
        >
          <Icon name={page.icon} />
        </NavLink>
      ))}
      <a
        href="/"
        target="_blank"
        rel="noopener"
        className={cx(iconButtonClass(), styles.railLink)}
        aria-label="Open funnel"
        title="Open funnel"
      >
        <Icon name="eye" />
      </a>
      <IconButton icon="search" aria-label="Search" onClick={onSearch} />
      <span className={styles.spacer} />
      <IconButton icon="help" aria-label="Commands and shortcuts" onClick={onSearch} />
      <Link
        to="/admin/versions"
        className={iconButtonClass(true)}
        aria-label="Settings (versions)"
        title="Settings"
      >
        <Icon name="gear" />
      </Link>
    </aside>
  );
}
