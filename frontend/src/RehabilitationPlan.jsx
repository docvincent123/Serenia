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
 const printRef=useRef(null);
 const canWrite=role==='psychologist'&&activeCourse?.status==='active';
 const currentGoals=goals.filter(g=>Number(g.course_id)===Number(activeCourse?.id));
 const completed=currentGoals.filter(g=>g.state==='achieved').length;
 async function load(){
  setLoading(true);setError('');
  try{setGoals(await api('GET','/api/patients/'+patientId+'/rehab-goals'));}
  catch(e){setError(e.message);}
  finally{setLoading(false);}
 }
 useEffect(()=>{void load();},[patientId]);
 async function addGoal(e){
  e.preventDefault();if(busy)return;
  setBusy(true);setError('');
  try{
   await api('POST','/api/patients/'+patientId+'/rehab-goals',form);
   setForm({title:'',measurement:'',baseline:'',target_value:'',target_date:''});
   setCreating(false);await load();
  }catch(e){setError(e.message);}finally{setBusy(false);}
 }
 async function saveUpdate(e){
  e.preventDefault();if(busy||!editing)return;
  setBusy(true);setError('');
  try{
   await api('PATCH','/api/rehab-goals/'+editing.id,{revision:editing.revision,...update});
   setEditing(null);await load();
  }catch(e){setError(e.message);}finally{setBusy(false);}
 }
 const printPlan=()=>{
  if(!printRef.current||!goals.length)return;
  onPrint(printRef.current,'План реабілітації — '+patientName);
 };
 return <section className="surface rehab-plan">
  <div className="section-head rehab-header"><div><div className="eyebrow">ІНДИВІДУАЛЬНИЙ ПЛАН</div><h2>Цілі реабілітації</h2><p>Цілі та результати конкретного курсу; історія змін зберігається.</p></div>
   <div className="row-actions">
    <button className="button secondary" type="button" onClick={load} disabled={loading}>Оновити</button>
    {!!goals.length&&<button className="button secondary" type="button" onClick={printPlan}>Друк / PDF</button>}
    {canWrite&&<button className="button primary" type="button" onClick={()=>{setCreating(v=>!v);setEditing(null);}}>+ Ціль</button>}
   </div>
  </div>
  {error&&<div role="alert" className="alert error">{error}</div>}
  {activeCourse&&<div className="rehab-summary"><span>Курс №{activeCourse.course_no}</span><strong>{completed} із {currentGoals.length} цілей досягнуто</strong></div>}
  {creating&&canWrite&&<form onSubmit={addGoal} className="rehab-form">
   <h3>Нова ціль</h3>
   <label>Ціль<input required maxLength={300} value={form.title} onChange={e=>setForm({...form,title:e.target.value})} placeholder="Наприклад: поступове відновлення повсякденної активності"/></label>
   <label>Як оцінюємо прогрес<input maxLength={500} value={form.measurement} onChange={e=>setForm({...form,measurement:e.target.value})} placeholder="Спостереження, опитувальник, функціональний тест"/></label>
   <div className="rehab-form-grid">
    <label>Початковий стан<input maxLength={500} value={form.baseline} onChange={e=>setForm({...form,baseline:e.target.value})}/></label>
    <label>Очікуваний результат<input maxLength={500} value={form.target_value} onChange={e=>setForm({...form,target_value:e.target.value})}/></label>
    <label>Контрольна дата<input type="date" value={form.target_date} onChange={e=>setForm({...form,target_date:e.target.value})}/></label>
   </div>
   <div className="form-actions"><button type="button" className="button secondary" onClick={()=>setCreating(false)}>Скасувати</button><button className="button primary" type="submit" disabled={busy}>Зберегти ціль</button></div>
  </form>}
  {loading?<p role="status">Завантажуємо план…</p>:!goals.length?<p className="rehab-empty">Цілей ще немає. Психолог може додати їх для активного курсу зі своєї картки пацієнта.</p>:
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
      {canWrite&&Number(goal.course_id)===Number(activeCourse?.id)&&<button type="button" className="button secondary" onClick={()=>{setCreating(false);setEditing(goal);setUpdate({state:goal.state,progress_value:goal.progress_value||'',note:''});}}>Зафіксувати прогрес</button>}
    </div>
    {editing?.id===goal.id&&canWrite&&<form className="rehab-form" onSubmit={saveUpdate}>
     <h4>Оновлення цілі</h4>
     <label>Статус<select value={update.state} onChange={e=>setUpdate({...update,state:e.target.value})}>{Object.entries(stateNames).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
     <label>Поточний результат<input maxLength={500} value={update.progress_value} onChange={e=>setUpdate({...update,progress_value:e.target.value})}/></label>
     <label>Пояснення зміни<textarea rows={3} required maxLength={2000} value={update.note} onChange={e=>setUpdate({...update,note:e.target.value})}/></label>
     <div className="form-actions"><button className="button secondary" type="button" onClick={()=>setEditing(null)}>Скасувати</button><button className="button primary" type="submit" disabled={busy}>Зберегти</button></div>
    </form>}
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
