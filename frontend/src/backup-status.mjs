// PostgreSQL to_char(..., 'SSOF') emits +00; JavaScript requires +00:00.
export function backupNeedsAttention(events = [], now = Date.now()) {
  if(events[0]?.status === 'failed') return true;
  return !events.some(event => {
    if(event.action !== 'backup' || event.status !== 'success') return false;
    const timestamp = Date.parse(String(event.created || '').replace(/([+-]\d{2})$/, '$1:00'));
    const age = now - timestamp;
    return Number.isFinite(timestamp) && age >= 0 && age < 36 * 3600000;
  });
}
