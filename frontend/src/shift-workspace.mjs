export function visitState(row) {
  if (row.completed_at) return 'completed';
  if (['cancelled','no_show'].includes(row.visit_status)||['cancelled', 'no_show', 'rescheduled'].includes(row.status)) return 'excluded';
  if (row.status === 'draft') return 'draft';
  if(row.started_at) return 'in_progress';
  return row.arrived_at ? 'arrived' : 'expected';
}
export function visitKey(row) { return `${row.appointment_id}:${row.patient_id}`; }
export function filterVisits(rows, { tab = 'active', psychologist = '', query = '', status = '' } = {}) {
  const text = query.trim().toLocaleLowerCase('uk');
  return rows.filter(row => {
    const state = visitState(row);
    const matchesTab = tab === 'completed' ? state === 'completed' : tab === 'excluded' ? state === 'excluded' : ['in_progress','arrived','expected'].includes(state);
    return matchesTab && (!status || state === status) && (!psychologist || String(row.psychologist_id) === String(psychologist)) &&
      (!text || [row.patient,row.patient_no,row.phone,row.psychologist,row.room].some(value => String(value || '').toLocaleLowerCase('uk').includes(text)));
  }).sort((a,b) => String(a.start || '').localeCompare(String(b.start || '')) || Number(a.appointment_id) - Number(b.appointment_id) || String(a.patient || '').localeCompare(String(b.patient || ''), 'uk'));
}

// Server timestamps without an offset describe local centre time, like appointment times.
export function waitingMinutes(row, now = Date.now()) {
  if (visitState(row) !== 'arrived') return null;
  const arrived = Date.parse(row.arrived_at);
  return Number.isFinite(arrived) ? Math.max(0, Math.floor((now - arrived) / 60000)) : null;
}
