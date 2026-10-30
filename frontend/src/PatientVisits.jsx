import React, {useEffect, useRef, useState} from 'react';
import './patient-visits.css';

const labels={scheduled:'Заплановано',confirmed:'Підтверджено',cancelled:'Скасовано',no_show:'Не з’явився',completed:'Проведено'};
function visitState(v){
 if(v.completed_at)return 'Проведено';
 if(v.visit_status)return labels[v.visit_status]||'Не проведено';
 if(v.status==='cancelled'||v.status==='no_show')return labels[v.status];
 if(v.started_at)return 'На прийомі';
 if(v.arrived_at)return 'У центрі';
 return labels[v.status]||'Заплановано';
}
export default function PatientVisits({api,patientId,canBook,onBook,refreshVersion=0}){
 const [period,setPeriod]=useState('upcoming'),[page,setPage]=useState(1),[revision,setRevision]=useState(0);
 const [result,setResult]=useState(null);
 const apiRef=useRef(api);apiRef.current=api;
 const key=JSON.stringify([patientId,period,page,revision,refreshVersion]);
 useEffect(()=>{
  let alive=true;
  apiRef.current('GET',`/api/patients/${patientId}/appointments?period=${period}&page=${page}`)
   .then(data=>{
    if(!Array.isArray(data?.items)||!Number.isInteger(data.total))throw new Error('Не вдалося прочитати прийоми. Оновіть сервер SOLVIA.');
    if(alive)setResult({key,...data});
   }).catch(e=>{if(alive)setResult({key,error:e.message});});
  return()=>{alive=false;};
 },[key]);
 const current=result?.key===key?result:null;
 return <section className="surface patient-visits" aria-label="Прийоми пацієнта">
  <div className="section-head"><div><div className="eyebrow">РОЗКЛАД ТА ВІДВІДУВАННЯ</div><h2>Прийоми пацієнта</h2><p>Наступні зустрічі та історія відвідувань в одній картці.</p></div>
   <div className="row-actions"><button type="button" className="button secondary" onClick={()=>setRevision(v=>v+1)} disabled={!current}>Оновити прийоми</button>{canBook&&<button type="button" className="button primary" onClick={()=>onBook({patientId})}>Записати на прийом</button>}</div>
  </div>
  <div className="directory-view-switch" role="group" aria-label="Період прийомів">{[['upcoming','Наступні'],['history','Історія']].map(([value,title])=><button type="button" key={value} aria-pressed={period===value} onClick={()=>{setPeriod(value);setPage(1);}}>{title}</button>)}</div>
  {!current?<p role="status">Завантажуємо прийоми…</p>:current.error?<div className="alert error" role="alert">{current.error} <button type="button" className="button secondary" onClick={()=>setRevision(v=>v+1)}>Повторити</button></div>:<>
   {!current.items.length?<p>{period==='upcoming'?'Наступних прийомів немає. Оберіть зручний час для нової зустрічі.':'Історія відвідувань поки порожня.'}</p>:<div className="patient-visits-list">{current.items.map(v=><article className="patient-visit-row" key={v.id}>
    <div className="patient-visit-time"><strong>{v.start.slice(0,10).split('-').reverse().join('.')}</strong><span>{v.start.slice(11,16)}–{v.end.slice(11,16)}</span></div>
    <div><strong>{v.psychologist}</strong><p>{v.room} · {v.kind==='group'?'Групове заняття':v.kind==='family'?'Сімейна зустріч':'Індивідуальний прийом'}</p></div>
    <span className="badge stone">{visitState(v)}</span>
    {canBook&&period==='upcoming'&&v.can_reschedule&&!v.started_at&&<button className="button secondary" type="button" onClick={()=>onBook({appointmentId:v.id,date:v.start.slice(0,10)})}>Перенести</button>}
   </article>)}</div>}
   {current.total>10&&<div className="directory-pagination"><button type="button" className="button secondary" disabled={page===1} onClick={()=>setPage(p=>p-1)}>Назад</button><span>Сторінка {page} з {Math.ceil(current.total/10)} · {current.total} прийомів</span><button type="button" className="button secondary" disabled={page*10>=current.total} onClick={()=>setPage(p=>p+1)}>Далі</button></div>}
  </>}
 </section>;
}
