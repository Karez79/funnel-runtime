// Number and time formatting for the admin, in one place so every screen writes
// "41.2%", "Oct 1, 10:42" and "+3.1 pts" the same way. English UI (CLAUDE.md 10).
const dateTime = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const integer = new Intl.NumberFormat('en-US');

export const formatDateTime = (iso: string) => dateTime.format(new Date(iso));
export const formatCount = (n: number) => integer.format(n);
