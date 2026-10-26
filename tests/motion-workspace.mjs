import assert from 'node:assert/strict';
import {modulesFor,timelineLayout} from '../frontend/src/motion-workspace.mjs';
import {navFor} from '../frontend/src/workspace-model.mjs';
import {focusNavigation, primaryKeysByRole} from '../frontend/src/focus-workspace.mjs';
for(const role of ['admin','director','reception','psychologist']){
 const modules=modulesFor(role);assert.equal(new Set(modules.map(m=>m.key)).size,modules.length);
 for(const [key] of navFor(role))assert(modules.some(m=>m.key===key),`Every existing ${role} module is discoverable`);
}
for (const role of ['admin','reception','psychologist','director']) {
 const navigation=[['module-directory','Усі розділи'],...navFor(role),['preferences','Налаштування профілю']];
 const {primary,secondary,directory}=focusNavigation(role,navigation);
 const keys=[...primary,...secondary].map(([key])=>key);
 assert.deepEqual(keys.slice().sort(),navFor(role).map(([key])=>key).sort(),`No ${role} module is lost in compact navigation`);
 assert.equal(new Set(keys).size,keys.length,'Navigation cannot duplicate a module');
 assert.equal(directory[0],'module-directory','Full catalogue remains available');
 assert(primary.every(([key])=>primaryKeysByRole[role].includes(key)));
}
assert(modulesFor('admin').some(m=>m.key==='settings'));assert(!modulesFor('reception').some(m=>['team','settings','audit','devices'].includes(m.key)));assert(!modulesFor('director').some(m=>m.key==='patients'));assert.deepEqual(modulesFor('unknown'),[]);
const ap=(id,start,end)=>({id,start:'2026-10-26T'+start,end:'2026-10-26T'+end,psychologist_id:3});
const layout=timelineLayout([ap(1,'09:00','10:00'),ap(2,'09:30','10:30'),ap(3,'10:30','11:00'),ap(4,'07:00','07:45'),ap(5,'21:00','22:00'),ap(6,'12:00','11:00'),ap(7,'26:00','27:00')],[{id:3,name:'Тестовий психолог'},{id:4,name:'Без записів'}]);
assert.equal(layout.start,420);assert.equal(layout.end,1320);assert.equal(layout.columns.length,2);assert.equal(layout.columns[1].events.length,0);assert.equal(layout.invalid.length,2);assert.equal(layout.columns[0].lanes,2);
const first=layout.columns[0].events.find(e=>e.item.id===1),second=layout.columns[0].events.find(e=>e.item.id===2);assert.notEqual(first.lane,second.lane,'Overlapping appointments must remain selectable side by side');
assert.equal(layout.columns[0].events.length+layout.invalid.length,7,'No records disappear from the time grid');
assert.equal(timelineLayout([{...ap(20,'10:00','11:00'),end:'2026-10-25T11:00'}]).invalid.length,1);
console.log('PASS: every authorized role module remains accessible; overlap lanes, empty psychologists, early/late times and invalid records retained');
