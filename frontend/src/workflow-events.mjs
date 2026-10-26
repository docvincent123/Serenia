export const eventTitles={
 'appointment.created':'Запис створено','appointment.updated':'Запис перенесено / оновлено','appointment.draft':'Чернетку запису збережено',
 'appointment.cancelled':'Запис скасовано','appointment.no_show':'Відмічено неявку','patient.arrived':'Пацієнт прибув',
 'patient.called':'Пацієнта запрошено до кабінету','consultation.started':'Консультацію розпочато','consultation.completed':'Консультацію завершено'
};
export function feedbackFor(method,path,body={}){
 if(method==='GET')return null;
 if(path==='/api/appointments'&&method==='POST')return {title:body.status==='draft'?eventTitles['appointment.draft']:eventTitles['appointment.created'],kind:'appointment.created'};
 if(/^\/api\/appointments\/\d+$/.test(path)&&method==='PATCH')return {title:body.status==='cancelled'?eventTitles['appointment.cancelled']:body.status==='no_show'?eventTitles['appointment.no_show']:eventTitles['appointment.updated']};
 if(path.endsWith('/arrival'))return {title:eventTitles['patient.arrived']};
 if(path.endsWith('/start'))return {title:eventTitles['consultation.started']};
 if(path.endsWith('/attendance'))return {title:body.status==='no_show'?eventTitles['appointment.no_show']:eventTitles['appointment.cancelled']};
 if(path==='/api/tv/call')return {title:method==='DELETE'?'Виклик на TV скасовано':'Виклик передано на TV'};
 if(path==='/api/consultations')return {title:eventTitles['consultation.completed']};
 if(path==='/api/patients'&&method==='POST')return {title:'Пацієнта зареєстровано'};
 if(path==='/api/staff/messages'&&method==='POST')return {title:'Повідомлення передано на сервер'};
 if(path==='/api/shift-reports'&&method==='POST')return {title:'Звіт за зміну збережено'};
 if(/\/discharges(?:\/\d+)?$/.test(path))return {title:'Виписку збережено'};
 if(method==='PATCH'&&/^\/api\/patients\/\d+$/.test(path))return {title:'Дані пацієнта оновлено'};
 if(method==='POST'&&['/api/users','/api/rooms','/api/families'].includes(path))return {title:'Дані збережено'};
 return null;
}
export function mergeWorkflow(history,events){const unique=new Map(history.map(e=>[String(e.id),e]));for(const e of events)if(e&&e.id&&eventTitles[e.kind])unique.set(String(e.id),e);return [...unique.values()].sort((a,b)=>Number(b.id)-Number(a.id)).slice(0,50);}
export function incomingWorkflow(data,cursor,userId){
 if(!data||!Array.isArray(data.events)||!Number.isSafeInteger(data.cursor)||data.cursor<0)return null;
 const initial=cursor===null||data.initial===true;
 const events=data.events.filter(e=>e&&eventTitles[e.kind]&&Number.isSafeInteger(e.id)&&e.id>0&&(initial||e.id>cursor));
 return {cursor:data.cursor,initial,events,alert:initial?[]:events.filter(e=>Number(e.actor_id)!==Number(userId)&&e.kind!=='appointment.draft')};
}
export class EventSound {
 constructor(){this.context=null;}
 async enable(){const Context=globalThis.AudioContext||globalThis.webkitAudioContext;if(!Context)return false;this.context??=new Context();await this.context.resume();return this.context.state==='running';}
 play(variant='event'){const c=this.context;if(c?.state!=='running')return false;[variant==='call'?660:523.25,variant==='call'?880:783.99].forEach((hz,i)=>{const o=c.createOscillator(),g=c.createGain(),t=c.currentTime+i*.14;o.type='sine';o.frequency.value=hz;g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(.1,t+.015);g.gain.exponentialRampToValueAtTime(.0001,t+.22);o.connect(g);g.connect(c.destination);o.start(t);o.stop(t+.24);});return true;}
 close(){this.context?.close().catch(()=>{});this.context=null;}
}
