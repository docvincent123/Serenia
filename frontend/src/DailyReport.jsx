import React, {useEffect, useState} from 'react';
import {visitState, visitKey} from './shift-workspace.mjs';

const labels={expected:'Очікується',arrived:'Прибув / прибула',in_progress:'Триває',completed:'Завершено',excluded:'Не проведено',draft:'Чернетка'};
export default function DailyReport({api, Modal, initialDate, onClose}) {
  const [date,setDate]=useState(initialDate),[rows,setRows]=useState(null),[error,setError]=useState(''),[retry,setRetry]=useState(0),[center,setCenter]=useState(null);
  useEffect(()=>{let alive=true;api('GET','/api/settings/center').then(value=>{if(alive)setCenter(value);}).catch(()=>{});return()=>{alive=false;};},[api]);
  useEffect(()=>{
    let current=true;setRows(null);setError('');
    api('GET',`/api/shift-workspace?date=${date}`).then(data=>{
      if(!Array.isArray(data)) throw new Error('Не вдалося отримати підсумок дня.');
      if(current)setRows(data);
    }).catch(e=>{if(current)setError(e.message);});
    return ()=>{current=false;};
  },[api,date,retry]);
  const completed=(rows||[]).filter(r=>visitState(r)==='completed').length;
  const excluded=(rows||[]).filter(r=>visitState(r)==='excluded').length;
  const active=(rows||[]).filter(r=>['expected','arrived','in_progress','draft'].includes(visitState(r))).length;
  const staff=[...new Set((rows||[]).map(r=>r.psychologist_id))].map(id=>{
    const visits=rows.filter(r=>r.psychologist_id===id);
    return {id,name:visits[0].psychologist,total:visits.length,done:visits.filter(r=>visitState(r)==='completed').length};
  });
  return <Modal title="Підсумок дня" subtitle="Операційний звіт за обрану дату. Клінічна зміна залишається відкритою." onClose={onClose} wide>
    <section className="daily-report" aria-label="Операційний звіт">
      <div className="daily-report-controls"><label className="field"><span>Дата звіту</span><input type="date" value={date} onChange={e=>{if(e.target.value)setDate(e.target.value);}} /></label><button className="button secondary" disabled={!rows} onClick={()=>window.print()}>Друк / PDF</button></div>
      <header className="daily-report-brand"><img src={center?.logo_data || '/solvia-icon.png'} alt=""/><div><span>ОПЕРАЦІЙНИЙ ЗВІТ</span><strong>{center?.center_name || 'SOLVIA'}</strong>{center?.address&&<small>{center.address}</small>}</div><b>{date.split('-').reverse().join('.')}</b></header>
      <p className="daily-report-date">Підсумок дня · {date.split('-').reverse().join('.')}</p>
      {error ? <div className="alert error" role="alert">{error} <button className="button secondary" onClick={()=>setRetry(n=>n+1)}>Повторити</button></div> : !rows ? <p role="status">Завантажуємо підсумок…</p> : <>
        <div className="daily-report-metrics">{[['Участей у прийомах',rows.length],['Завершено',completed],['Незавершено',active],['Не проведено',excluded]].map(([name,value])=><article key={name}><span>{name}</span><strong>{value}</strong></article>)}</div>
        <p className="daily-report-note">Один учасник групи — одна участь. Незавершені прийоми залишаються в робочому списку.</p>
        {rows.length===0 ? <p>На цю дату прийомів немає.</p> : <>
          <h3>Робота психологів</h3><div className="workspace-table-scroll"><table className="workspace-table"><thead><tr><th>Психолог</th><th>Участей</th><th>Завершено</th></tr></thead><tbody>{staff.map(s=><tr key={s.id}><td>{s.name}</td><td>{s.total}</td><td>{s.done}</td></tr>)}</tbody></table></div>
          <h3>Прийоми за день</h3><div className="workspace-table-scroll"><table className="workspace-table"><thead><tr><th>Час</th><th>Пацієнт</th><th>Психолог / кабінет</th><th>Результат</th></tr></thead><tbody>{[...rows].sort((a,b)=>String(a.start).localeCompare(String(b.start))).map(r=><tr key={visitKey(r)}><td>{r.start?.slice(11,16)}–{r.end?.slice(11,16)}</td><td>{r.patient}<small>№ {r.patient_no || '—'}</small></td><td>{r.psychologist}<small>{r.room}</small></td><td>{labels[visitState(r)]}</td></tr>)}</tbody></table></div>
        </>}
      <footer className="daily-report-footer"><span>SOLVIA · Підсумок за даними розкладу</span><span>Сформовано {new Date().toLocaleString('uk-UA')}</span></footer>
      </>}
    </section>
  </Modal>;
}
