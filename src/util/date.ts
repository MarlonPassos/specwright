/**
 * Local calendar date as `YYYY-MM-DD`.
 *
 * Archive directories are named after the day the user archived on, so the
 * local calendar is the right clock: `toISOString()` would roll the name onto
 * the previous or next day for anyone far enough from UTC.
 */
export function localDateStamp(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}
