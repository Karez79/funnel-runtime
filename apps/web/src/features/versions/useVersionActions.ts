// Version mutations of the Versions page (CLAUDE.md 6.1, 11.1). Every successful write
// drops all cached server state: the active version changes what the dashboard, the
// palette and the table show. Toasts repeat the verb ("Published", "Rolled back") and a
// publish toast offers the way back.
import { DomainError } from '@funnel/shared';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { call } from '../../lib/api.ts';
import type { ToastMessage } from '../../ui/Toast.tsx';

let toastSeq = 0;

function errorText(error: unknown): string {
  return error instanceof DomainError ? error.message : 'Something went wrong, try again';
}

export function useVersionActions() {
  const queryClient = useQueryClient();
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const say = (text: string, action?: ToastMessage['action']) => {
    toastSeq += 1;
    setToast({ id: toastSeq, text, ...(action ? { action } : {}) });
  };
  const done = () => queryClient.invalidateQueries();

  const rollback = useMutation({
    mutationFn: () => call('rollback', { body: {} }),
    onSuccess: async ({ activation }) => {
      await done();
      say(`Rolled back to version ${String(activation.version)}`);
    },
    onError: (error) => {
      say(errorText(error));
    },
  });

  const publish = useMutation({
    mutationFn: (version: number) => call('publishVersion', { params: { v: version }, body: {} }),
    onSuccess: async ({ activation }) => {
      await done();
      say(`Published version ${String(activation.version)}`, {
        label: 'Roll back',
        icon: 'undo',
        onClick: () => {
          rollback.mutate();
        },
      });
    },
    onError: (error) => {
      say(errorText(error));
    },
  });

  const activate = useMutation({
    mutationFn: (version: number) => call('activateVersion', { params: { v: version }, body: {} }),
    onSuccess: async ({ activation }) => {
      await done();
      say(`Activated version ${String(activation.version)}`);
    },
    onError: (error) => {
      say(errorText(error));
    },
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      let config: unknown;
      try {
        config = JSON.parse(await file.text());
      } catch {
        throw new DomainError('invalid_request', `${file.name} is not valid JSON`);
      }
      return call('uploadVersion', { body: config, query: {} });
    },
    onSuccess: async ({ version, created }) => {
      await done();
      const v = String(version.version);
      say(created ? `Uploaded version ${v} as a draft` : `Version ${v} is already stored`);
    },
    onError: (error) => {
      say(`Upload failed: ${errorText(error)}`);
    },
  });

  return {
    toast,
    closeToast: () => {
      setToast(null);
    },
    publish,
    rollback,
    activate,
    upload,
  };
}
