// Error state of the admin (route errorElement and the /admin catch-all): an unknown
// path, a page that threw while rendering, or a lazy page chunk that is gone because the
// app was redeployed while the tab stayed open. It is bundled with the router, not lazily, so it still
// renders when the admin chunks themselves fail to load. "Back to dashboard" is a full
// page load on purpose: it also picks up the new build after a redeploy.
import { useRouteError } from 'react-router';
import { Button, ButtonLink } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import styles from './AdminError.module.css';

/**
 * A lazy chunk could not be fetched: the browsers' import() messages, and Vite's preload
 * helper, which fails first when the page's CSS chunk is gone too (a real redeploy).
 */
const CHUNK_FAILED =
  /dynamically imported module|module script failed|loading chunk|unable to preload/i;

function describe(notFound: boolean, error: unknown): { title: string; text: string } {
  if (notFound) {
    return { title: 'Page not found', text: 'There is no admin page at this address.' };
  }
  if (error instanceof Error && CHUNK_FAILED.test(error.message)) {
    return {
      title: 'A new version is available',
      text: 'The admin was updated while this tab was open. Reload to continue.',
    };
  }
  return {
    title: 'Something went wrong',
    text: 'This page could not be shown. Reload it or go back to the dashboard.',
  };
}

export function AdminError({ notFound = false }: { notFound?: boolean }) {
  const { title, text } = describe(notFound, useRouteError());
  return (
    <div className={styles.wrap}>
      <Card variant="panel" className={styles.panel} role="alert">
        <h1>{title}</h1>
        <p>{text}</p>
        <div className={styles.actions}>
          {notFound ? (
            // Reloading a missing page only shows it again: the dashboard is the one action.
            <ButtonLink href="/admin">Back to dashboard</ButtonLink>
          ) : (
            <>
              <Button
                onClick={() => {
                  window.location.reload();
                }}
              >
                Reload
              </Button>
              <a className={styles.link} href="/admin">
                Back to dashboard
              </a>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}
