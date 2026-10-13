export function visitState(row) {
  if (row.completed_at) return 'completed';
  if (['cancelled', 'no_show', 'rescheduled'].includes(row.status)) return 'excluded';
  if (row.status === 'draft') return 'draft';
  return row.arrived_at ? 'arrived' : 'expected';
}
export function visitKey(row) { return `${row.appointment_id}:${row.patient_id}`; }
export function filterVisits(rows, { tab = 'active', psychologist = '', query = '' } = {}) {
  const text = query.trim().toLocaleLowerCase('uk');
  return rows.filter(row => {
    const state = visitState(row);
    const matchesTab = tab === 'completed' ? state === 'completed' : tab === 'excluded' ? state === 'excluded' : ['arrived','expected'].includes(state);
    return matchesTab && (!psychologist || String(row.psychologist_id) === psychologist) &&
      (!text || [row.patient,row.patient_no,row.phone,row.psychologist].some(value => String(value || '').toLocaleLowerCase('uk').includes(text)));
  });
}
