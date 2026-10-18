export const TV_KEY = 'solvia_tv_device_v1';
export function pageEntries(entries, page, size) {
  const pages = Math.max(1, Math.ceil(entries.length / size));
  return { pages, page: page % pages, rows: entries.slice((page % pages) * size, (page % pages + 1) * size) };
}
export function liveCalls(entries) {
  return entries.filter(x => x.state === 'called').sort((a,b) => b.called_at-a.called_at);
}
export function serverClock(snapshot, receivedAt, currentTime) {
  const parts = snapshot.server_time.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/);
  if (!parts) return null;
  // Represent the server's wall clock in UTC to avoid the TV's configured timezone.
  const [,y,m,d,h,min,s] = parts.map(Number);
  return new Date(Date.UTC(y,m-1,d,h,min,s) + Math.max(0,currentTime-receivedAt));
}
