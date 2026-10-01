// Dashboard filters live in the URL (CLAUDE.md 11.2: version, variant, utm_campaign,
// period, Include QA, plus the utm_source notch), so a filtered view can be shared and
// survives a refresh. The query object is exactly the contract's analytics filters.
import { VariantFilterSchema } from '@funnel/shared';
import { useSearchParams } from 'react-router';

export const PERIODS = [
  { value: 'all', label: 'All time', hours: null },
  { value: '24h', label: 'Last 24 hours', hours: 24 },
  { value: '7d', label: 'Last 7 days', hours: 24 * 7 },
  { value: '30d', label: 'Last 30 days', hours: 24 * 30 },
] as const;

export type Variant = 'A' | 'B' | 'all';

export function useDashboardFilters() {
  const [params, setParams] = useSearchParams();
  const get = (key: string) => params.get(key) ?? undefined;
  const variantParsed = VariantFilterSchema.safeParse(params.get('variant'));
  const variant: Variant = variantParsed.success ? variantParsed.data : 'all';
  const version = get('version');
  const campaign = get('campaign');
  const source = get('source');
  const from = get('from');
  const includeQa = params.get('qa') === '1';

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) next.delete(key);
      else next.set(key, value);
    }
    setParams(next, { replace: true });
  };

  return {
    variant,
    campaign: campaign ?? null,
    source: source ?? null,
    period: get('period') ?? 'all',
    includeQa,
    query: {
      variant,
      includeQa: includeQa ? ('true' as const) : ('false' as const),
      ...(version === undefined ? {} : { version }),
      ...(campaign === undefined ? {} : { campaign }),
      ...(source === undefined ? {} : { source }),
      ...(from === undefined ? {} : { from }),
    },
    setVersion: (v: number) => {
      set({ version: String(v) });
    },
    setVariant: (v: Variant) => {
      set({ variant: v === 'all' ? null : v });
    },
    setCampaign: (c: string | null) => {
      set({ campaign: c });
    },
    toggleSource: (s: string | null) => {
      set({ source: s === null || s === source ? null : s });
    },
    setPeriod: (value: string) => {
      const period = PERIODS.find((p) => p.value === value);
      const hours = period?.hours ?? null;
      // The start is fixed when chosen, so the query (and its cache key) stays stable.
      const start = hours === null ? null : new Date(Date.now() - hours * 3_600_000).toISOString();
      set({ period: hours === null ? null : value, from: start });
    },
    toggleQa: () => {
      set({ qa: includeQa ? null : '1' });
    },
  };
}
export type DashboardFilters = ReturnType<typeof useDashboardFilters>;
