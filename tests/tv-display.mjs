import assert from 'node:assert/strict';
import {pageEntries,liveCalls,serverClock} from '../frontend/src/tv/model.mjs';

const entries=Array.from({length:17},(_,id)=>({id,state:id%3===0?'called':'scheduled',called_at:id}));
assert.deepEqual(pageEntries(entries,0,6).rows.map(x=>x.id),[0,1,2,3,4,5]);
assert.deepEqual(pageEntries(entries,2,6).rows.map(x=>x.id),[12,13,14,15,16]);
assert.equal(pageEntries(entries,3,6).page,0);
assert.deepEqual(pageEntries([],999,6),{pages:1,page:0,rows:[]});
assert.equal(liveCalls(entries)[0].id,15);
const received=10000;
const date=serverClock({server_time:'2026-10-18T23:59:59'},received,received+2000);
assert.equal(date.toISOString(),'2026-10-19T00:00:01.000Z');
assert.equal(serverClock({server_time:'invalid'},received,received),null);
assert.equal(serverClock({server_time:'2026-10-18T14:30:00'},received,received).toISOString(),'2026-10-18T14:30:00.000Z');
console.log('PASS: TV pagination wraps, shrinks safely, sorts calls and follows server wall time across midnight');
