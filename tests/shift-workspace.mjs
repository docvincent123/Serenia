import assert from 'node:assert/strict';
import {filterVisits,visitState,visitKey} from '../frontend/src/shift-workspace.mjs';
const group = {appointment_id:10,psychologist_id:3,patient:'Тестовий пацієнт',patient_no:'12345',status:'scheduled'};
const rows=[{...group,patient_id:1,completed_at:'2026-10-13T10:00:00'}, {...group,patient_id:2,arrived_at:'2026-10-13T09:00:00'},
  {...group,appointment_id:11,patient_id:1}, {...group,appointment_id:12,patient_id:3,status:'no_show'},
  {...group,appointment_id:13,patient_id:4,status:'draft'}];
assert.equal(visitState(rows[0]),'completed','Individual completion must win over an unfinished group status');
assert.equal(filterVisits(rows).length,2);
assert.equal(filterVisits(rows,{tab:'completed'}).length,1);
assert.equal(filterVisits(rows,{tab:'excluded'}).length,1);
assert.equal(filterVisits(rows,{query:'12345',psychologist:'3'}).length,2);
assert.equal(filterVisits(rows,{psychologist:'4'}).length,0);
assert.equal(new Set(rows.map(visitKey)).size,rows.length,'Repeated visits of one patient remain separate');
console.log('Shift workspace classification checks passed');

assert.equal(visitState({...group,started_at:'2026-10-13T09:00'}),'in_progress');
assert.equal(filterVisits([{...group,started_at:'2026-10-13T09:00'}]).length,1);
