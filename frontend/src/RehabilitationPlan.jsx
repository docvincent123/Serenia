import React,{useEffect,useMemo,useRef,useState} from 'react';
import './rehabilitation.css';

const stateNames={planned:'Заплановано',in_progress:'У роботі',achieved:'Досягнуто',paused:'Призупинено'};
const dateOnly=value=>value?String(value).slice(0,10):'—';

export function PatientJourney({card,canReadClinical=false}){
 const events=useMemo(()=>{
  const rows=[];
  for(const c of card.courses||[]){
   rows.push({when:c.started_at,key:'course-'+c.id,title:'Розпочато курс №'+c.course_no,detail:c.reason||'Курс реабілітаційного супроводу'});
   if(c.ended_at)rows.push({when:c.ended_at,key:'course-end-'+c.id,title:'Курс №'+c.course_no+' завершено',detail:c.outcome||'Підсумок не зазначено'});
  }
  for(const d of card.documents||[])rows.push({when:d.signed_at||d.created,key:'doc-'+d.id,title:'Документ: '+d.title,detail:d.status==='signed'?'Підписано':'Відмова'});
  for(const r of card.referrals||[])rows.push({when:r.created,key:'ref-'+r.id,title:'Направлення: '+r.destination_type,detail:r.status||''});
  if(canReadClinical)for(const c of card.consultations||[])rows.push({when:c.created,key:'consult-'+c.id,title:'Проведена консультація',detail:c.consultation_type||'Психологічна консультація'});
  return rows.filter(e=>e.when).sort((a,b)=>String(b.when).localeCompare(String(a.when))).slice(0,80);
 },[card,canReadClinical]);
 return <section className="surface rehab-journey" aria-label="Шлях пацієнта">
  <div className="section-head"><div><div className="eyebrow">ІСТОРІЯ СУПРОВОДУ</div><h2>Шлях пацієнта</h2></div></div>
  {!events.length?<p>Історія з’явиться після першої дії з карткою.</p>:<ol className="rehab-timeline">{events.map(e=><li key={e.key}><time>{dateOnly(e.when)}</time><div><strong>{e.title}</strong><p>{e.detail}</p></div></li>)}</ol>}
 </section>;
}

export default function RehabilitationPlan({api,patientId,patientName,patientNumber,activeCourse,role,onPrint}){
 const [goals,setGoals]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 const [creating,setCreating]=useState(false),[editing,setEditing]=useState(null);
 const [form,setForm]=useState({title:'',measurement:'',baseline:'',target_value:'',target_date:''});
 const [update,setUpdate]=useState({state:'in_progress',progress_value:'',note:''});
 const printRef=useRef(null),apiRef=useRef(api),sequence=useRef(0),saving=useRef(false),receipt=useRef(null);apiRef.current=api;
 const [conflict,setConflict]=useState(false),[notice,setNotice]=useState('');
 const canWrite=role==='psychologist'&&activeCourse?.status==='active';
 const currentGoals=goals.filter(g=>Number(g.course_id)===Number(activeCourse?.id));
 const completed=currentGoals.filter(g=>g.state==='achieved').length;
 function requestBody(body,tag){
  const signature=JSON.stringify([patientId,tag,body]);
  if(receipt.current?.signature!==signature)receipt.current={signature,key:crypto.randomUUID()};
  return {...body,client_key:receipt.current.key};
 }
 async function load(){
  const request=++sequence.current;setLoading(true);
  try{
   const value=await apiRef.current('GET','/api/patients/'+patientId+'/rehab-goals');
   if(!Array.isArray(value))throw new Error('Не вдалося прочитати план реабілітації.');
   if(request===sequence.current){setGoals(value);setError('');}
  }catch(e){if(request===sequence.current){setGoals([]);setError(e.message);}}
  finally{if(request===sequence.current)setLoading(false);}
 }
 useEffect(()=>{void load();return()=>{++sequence.current;};},[patientId]);
 async function addGoal(e){
  e.preventDefault();if(saving.current)return;
  saving.current=true;setBusy(true);setError('');setNotice('');
  try{
   await apiRef.current('POST','/api/patients/'+patientId+'/rehab-goals',requestBody(form,'create'));
   receipt.current=null;setForm({title:'',measurement:'',baseline:'',target_value:'',target_date:''});
   setCreating(false);setNotice('Ціль збережено.');await load();
  }catch(e){setError(e.message);}finally{saving.current=false;setBusy(false);}
 }
 async function saveUpdate(e){
  e.preventDefault();if(saving.current||!editing)return;
  saving.current=true;setBusy(true);setError('');setNotice('');setConflict(false);
  try{
   await apiRef.current('PATCH','/api/rehab-goals/'+editing.id,requestBody({revision:editing.revision,...update},'update:'+editing.id));
   receipt.current=null;setEditing(null);setNotice('Прогрес збережено.');await load();
  }catch(e){setError(e.message);setConflict(e.status===409);}finally{saving.current=false;setBusy(false);}
 }
 async function reloadConflict(){
  if(saving.current||!editing)return;saving.current=true;setBusy(true);
  try{
   const latest=await apiRef.current('GET','/api/rehab-goals/'+editing.id);
   if(Number(latest.patient_id)!==Number(patientId)||!Number.isInteger(latest.revision))throw new Error('Не вдалося прочитати актуальну ціль.');
   setEditing(latest);setGoals(items=>items.map(g=>g.id===latest.id?{...g,...latest}:g));
   receipt.current=null;setConflict(false);setError('');setNotice('Дані цілі оновлено. Ваш текст збережено у формі — перевірте його перед повторним збереженням.');
  }catch(e){setError(e.message);}finally{saving.current=false;setBusy(false);}
 }
 const printPlan=()=>{
  if(!printRef.current||!goals.length)return;
  onPrint(printRef.current,'План реабілітації — '+patientName);
 };
 return <section className="surface rehab-plan">
  <div className="section-head rehab-header"><div><div className="eyebrow">ІНДИВІДУАЛЬНИЙ ПЛАН</div><h2>Цілі реабілітації</h2><p>Цілі та результати конкретного курсу; історія змін зберігається.</p></div>
   <div className="row-actions">
    <button className="button secondary" type="button" onClick={load} disabled={loading||busy}>Оновити</button>
    {!!goals.length&&<button className="button secondary" type="button" onClick={printPlan} disabled={loading||busy}>Друк / PDF</button>}
    {canWrite&&<button className="button primary" type="button" disabled={loading||busy} onClick={()=>{setCreating(v=>!v);setEditing(null);setConflict(false);setNotice('');}}>+ Ціль</button>}
   </div>
  </div>
  {error&&<div role="alert" className="alert error">{error}{conflict&&editing&&<button type="button" className="button secondary" disabled={busy} onClick={reloadConflict}>Оновити дані цілі</button>}</div>}
  {notice&&<p role="status" className="alert">{notice}</p>}
  {activeCourse&&<div className="rehab-summary"><span>Курс №{activeCourse.course_no}</span><strong>{completed} із {currentGoals.length} цілей досягнуто</strong></div>}
  {creating&&canWrite&&<form onSubmit={addGoal} className="rehab-form"><fieldset disabled={busy} className="rehab-fields">
   <h3>Нова ціль</h3>
   <label>Ціль<input required maxLength={300} value={form.title} onChange={e=>setForm({...form,title:e.target.value})} placeholder="Наприклад: поступове відновлення повсякденної активності"/></label>
   <label>Як оцінюємо прогрес<input maxLength={500} value={form.measurement} onChange={e=>setForm({...form,measurement:e.target.value})} placeholder="Спостереження, опитувальник, функціональний тест"/></label>
   <div className="rehab-form-grid">
    <label>Початковий стан<input maxLength={500} value={form.baseline} onChange={e=>setForm({...form,baseline:e.target.value})}/></label>
    <label>Очікуваний результат<input maxLength={500} value={form.target_value} onChange={e=>setForm({...form,target_value:e.target.value})}/></label>
    <label>Контрольна дата<input type="date" value={form.target_date} onChange={e=>setForm({...form,target_date:e.target.value})}/></label>
   </div>
   <div className="form-actions"><button type="button" className="button secondary" onClick={()=>setCreating(false)}>Скасувати</button><button className="button primary" type="submit" disabled={busy}>Зберегти ціль</button></div>
  </fieldset></form>}
  {loading?<p role="status">Завантажуємо план…</p>:!goals.length?<p className="rehab-empty">{error?'План недоступний. Натисніть «Оновити», щоб повторити завантаження.':<>Цілей ще немає. Психолог може додати їх для активного курсу зі своєї картки пацієнта.</>}</p>:
   <div className="rehab-goals">{goals.map(goal=><article className="rehab-goal" key={goal.id}>
    <div className="rehab-goal-head"><div><span className="eyebrow">КУРС №{goal.course_no} · {goal.owner_name}</span><h3>{goal.title}</h3></div><span className={'rehab-goal-state '+goal.state}>{stateNames[goal.state]||goal.state}</span></div>
    <div className="rehab-goal-facts">
     {goal.measurement&&<span><b>Оцінка:</b> {goal.measurement}</span>}
     {goal.baseline&&<span><b>Було:</b> {goal.baseline}</span>}
     {goal.target_value&&<span><b>Мета:</b> {goal.target_value}</span>}
     {goal.progress_value&&<span><b>Зараз:</b> {goal.progress_value}</span>}
     {goal.target_date&&<span><b>Перегляд:</b> {dateOnly(goal.target_date)}</span>}
    </div>
    <div className="rehab-goal-bottom">
      <details><summary>Історія змін ({goal.updates?.length||0})</summary><ol>{(goal.updates||[]).map(e=><li key={e.id}><strong>{stateNames[e.state]||e.state}</strong> · {dateOnly(e.created)} · {e.author_name}{e.progress_value&&<p>Результат: {e.progress_value}</p>}{e.note&&<p>{e.note}</p>}</li>)}</ol></details>
      {canWrite&&Number(goal.course_id)===Number(activeCourse?.id)&&<button type="button" className="button secondary" disabled={busy} onClick={()=>{setCreating(false);setEditing(goal);setConflict(false);setNotice('');setUpdate({state:goal.state,progress_value:goal.progress_value||'',note:''});}}>Зафіксувати прогрес</button>}
    </div>
    {editing?.id===goal.id&&canWrite&&<form className="rehab-form" onSubmit={saveUpdate}><fieldset disabled={busy} className="rehab-fields">
     <h4>Оновлення цілі</h4>
     <label>Статус<select value={update.state} onChange={e=>setUpdate({...update,state:e.target.value})}>{Object.entries(stateNames).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
     <label>Поточний результат<input maxLength={500} value={update.progress_value} onChange={e=>setUpdate({...update,progress_value:e.target.value})}/></label>
     <label htmlFor={'rehab-note-'+goal.id}>Пояснення зміни</label><textarea id={'rehab-note-'+goal.id} rows={3} required maxLength={2000} value={update.note} onChange={e=>setUpdate({...update,note:e.target.value})}/>
     <div className="form-actions"><button className="button secondary" type="button" onClick={()=>setEditing(null)}>Скасувати</button><button className="button primary" type="submit" disabled={busy}>Зберегти</button></div>
    </fieldset></form>}
   </article>)}</div>}
  <div className="rehab-print-host" aria-hidden="true"><div ref={printRef} className="discharge-print">
   <div className="discharge-header"><div className="discharge-center-copy"><strong>SOLVIA · Реабілітаційний план</strong><p>План цілей, історія та поточні результати — для перевірки спеціалістом</p></div></div>
   <div className="discharge-title"><h1>Індивідуальний план реабілітації</h1><p>{patientName} · №{patientNumber||'—'}</p></div>
   {goals.map(g=><section key={g.id}><h3>{g.title} · Курс №{g.course_no}</h3><p>Відповідальний: {g.owner_name}. Статус: {stateNames[g.state]||g.state}. Дата перегляду: {dateOnly(g.target_date)}.</p><p>Початковий стан: {g.baseline||'—'}. Очікуваний результат: {g.target_value||'—'}. Поточний: {g.progress_value||'—'}.</p></section>)}
   <div className="signature-grid"><div className="signature-block"><strong>Спеціаліст</strong><div className="signature-line">Підпис, ПІБ, дата</div></div><div className="signature-block"><strong>Керівник</strong><div className="signature-line">Підпис, ПІБ, дата</div></div></div>
   <div className="discharge-footer">Документ для перевірки й підписання. Друк не є електронним підписом.</div>
  </div></div>
 </section>;
}
