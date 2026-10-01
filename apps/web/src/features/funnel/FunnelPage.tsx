// The funnel page: loads or starts the session (server state through TanStack Query) and
// renders the funnel card over the soft glow (CLAUDE.md 8, 10). Step rendering arrives
// with the step registry; for now the card shows the session's current step.
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { Button } from '../../ui/Button.tsx';
import { Card } from '../../ui/Card.tsx';
import { IconButton } from '../../ui/IconButton.tsx';
import { Toast, type ToastMessage } from '../../ui/Toast.tsx';
import styles from './FunnelPage.module.css';
import { DEFAULT_FUNNEL_ID, loadSession } from './session.ts';

const EXPIRED_NOTICE = 'Your previous answers expired, starting over';

export function FunnelPage() {
  const [search] = useSearchParams();
  const [noticeSeen, setNoticeSeen] = useState(false);
  const query = useQuery({
    queryKey: ['funnel-session', DEFAULT_FUNNEL_ID],
    queryFn: () => loadSession(DEFAULT_FUNNEL_ID, search),
    staleTime: Infinity,
    retry: false,
  });
  const notice: ToastMessage | null =
    query.data?.expired && !noticeSeen ? { id: 1, text: EXPIRED_NOTICE } : null;

  const response = query.data?.response;
  const step = response?.funnel.steps[response.session.state.currentStepId];

  return (
    <main className={styles.wrap}>
      <Card variant="glass" className={styles.card} aria-busy={query.isPending}>
        <div className={styles.top}>
          <IconButton icon="back" aria-label="Back" disabled />
        </div>
        {query.isError ? (
          <div className={styles.body}>
            <h1 className={styles.title}>We could not start the funnel</h1>
            <Button onClick={() => void query.refetch()}>Try again</Button>
          </div>
        ) : (
          <div className={styles.body}>
            {response && (
              <h1 className={styles.title}>{step?.content.title ?? response.funnel.meta.title}</h1>
            )}
            {step?.content.body && <p className={styles.text}>{step.content.body}</p>}
          </div>
        )}
      </Card>
      <Toast
        message={notice}
        onClose={() => {
          setNoticeSeen(true);
        }}
      />
    </main>
  );
}
