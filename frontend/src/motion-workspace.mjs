import {navFor,navigationGroups} from './workspace-model.mjs';
export const descriptions={dashboard:'Показники та робота центру', 'shift-workspace':'Прибуття й перебіг консультацій',handover:'Організаційні справи між змінами',calendar:'Розклад психологів і кабінетів','waiting-list':'Очікування та підбір вільного часу',patients:'Картки й історія супроводу',families:'Сімейні зв’язки пацієнтів',team:'Працівники, ролі та облікові записи','staff-messages':'Зв’язок із працівниками',rooms:'Кабінети й групові приміщення',reports:'Підсумки роботи психологів',discharges:'Підсумки супроводу й рекомендації',workload:'Завантаження спеціалістів',supervisions:'Планування супервізій',archive:'Завершені курси та картки',devices:'Підключені телефони й сеанси',settings:'Центр, документи та параметри роботи',audit:'Історія дій у системі','tv-calls':'Виклики пацієнтів на табло',preferences:'Особисті налаштування'};
export function modulesFor(role){
 const items=[...navFor(role)];
 if(['admin','reception','psychologist'].includes(role))items.push(['tv-calls','TV-виклики']);
 if(items.length)items.push(['preferences','Налаштування профілю']);
 return items.map(([key,title])=>({key,title,description:descriptions[key]||'',group:key==='preferences'?'account':navigationGroups.find(([, ,keys])=>keys.includes(key))?.[0]||'administration'}));
}
export function timelineLayout(items,people=[]){
 const clock=value=>{const match=/^\d{4}-\d{2}-\d{2}T(\d{2}):(\d{2})/.exec(String(value));return match&&+match[1]<24&&+match[2]<60?+match[1]*60+(+match[2]):null;};
 const columns=new Map(people.map(p=>[String(p.id),{id:String(p.id),name:p.name,events:[]}])),invalid=[];
 for(const item of items){const start=clock(item.start);let end=clock(item.end);if(start===null||end===null||String(item.end).slice(0,10)<String(item.start).slice(0,10)){invalid.push(item);continue;}if(String(item.end).slice(0,10)>String(item.start).slice(0,10))end+=1440;if(end<=start){invalid.push(item);continue;}
 const id=String(item.psychologist_id??item.psychologist??'unassigned');if(!columns.has(id))columns.set(id,{id,name:item.psychologist||'Психолог не вказаний',events:[]});columns.get(id).events.push({item,start,end:Math.min(1440,end)});}
 if(!columns.size)columns.set('empty',{id:'empty',name:'Розклад консультацій',events:[]});
 const events=[...columns.values()].flatMap(c=>c.events),start=Math.min(480,...events.map(e=>Math.floor(e.start/60)*60)),end=Math.max(1200,...events.map(e=>Math.ceil(e.end/60)*60));
 for(const column of columns.values()) {const ends=[];column.events.sort((a,b)=>a.start-b.start||a.end-b.end);for(const event of column.events){let lane=ends.findIndex(t=>t<=event.start);if(lane<0)lane=ends.length;ends[lane]=event.end;event.lane=lane;}column.lanes=Math.max(1,ends.length);}
 return {columns:[...columns.values()],start,end,invalid};
}
