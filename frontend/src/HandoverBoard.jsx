import React,{useCallback,useEffect,useRef,useState} from 'react';
import './handover.css';

const labels={normal:'Звичайне',important:'Важливе',urgent:'Термінове'};
const states={open:'Не виконано',resolved:'Виконано'};
export default function HandoverBoard({api}){
 const [items,setItems]=useState([]),[summary,setSummary]=useState(''),[priority,setPriority]=useState('normal');
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true);
 const [showClosed,setShowClosed]=useState(false);
 const key=useRef(crypto.randomUUID());
 const sequence=useRef(0);
 const apiRef=useRef(api);apiRef.current=api;
 const reload=useCallback(async()=>{
  const request=++sequence.current;setLoading(true);
  try{const list=await apiRef.current('GET','/api/operations/handover');if(request===sequence.current){setItems(list);}}
  catch(e){if(request===sequence.current){setItems([]);setError(e.message);}}finally{if(request===sequence.current)setLoading(false);}
 },[]);
 useEffect(()=>{void reload();const timer=setInterval(()=>{if(!document.hidden)void reload();},30000);return()=>{++sequence.current;clearInterval(timer);};},[reload]);
 async function add(e){
  e.preventDefault();if(busy||!summary.trim())return;
  setBusy(true);setError('');
  try{await apiRef.current('POST','/api/operations/handover',{summary:summary.trim(),priority,client_key:key.current});
   key.current=crypto.randomUUID();setSummary('');setPriority('normal');await reload();
  }catch(e){setError(e.message);}finally{setBusy(false);}
 }
 async function resolve(id){
  if(busy)return;setBusy(true);setError('');
  try{await apiRef.current('PATCH',`/api/operations/handover/${id}`,{state:'resolved'});await reload();}
  catch(e){setError(e.message);}finally{setBusy(false);}
 }
 const open=items.filter(x=>x.state==='open');
 const shown=showClosed?items:open;
 return <section className="handover-board">
  <header className="page-head">
   <div><div className="eyebrow">ОПЕРАТИВНА РОБОТА</div><h1>Передача зміни</h1>
    <p>Організаційні справи, які наступна зміна не повинна пропустити. Без діагнозів, деталей консультацій і приватних нотаток.</p></div>
   <button type="button" className="button secondary" onClick={()=>{setError('');void reload();}} disabled={loading}>Оновити</button>
  </header>
  <div className="handover-layout">
   <form className="surface handover-form" onSubmit={add}>
    <h2>Нове завдання</h2>
    <label>Що потрібно передати?<textarea disabled={busy} required maxLength={300} rows={4} placeholder="Наприклад: перевірити доступність кабінету №3" value={summary} onChange={e=>{setSummary(e.target.value);key.current=crypto.randomUUID();}} /></label>
    <label>Пріоритет<select disabled={busy} value={priority} onChange={e=>{setPriority(e.target.value);key.current=crypto.randomUUID();}}><option value="normal">Звичайне</option><option value="important">Важливе</option><option value="urgent">Термінове</option></select></label>
    <button className="button primary" disabled={busy||!summary.trim()}>{busy?'Зберігаємо…':'Передати наступній зміні'}</button>
    <small>Завдання зберігаються на сервері та доступні адміністратору й реєстратурі.</small>
   </form>
   <div className="surface handover-list">
    <div className="handover-list-head"><div><h2>Незавершені справи</h2><p role="status">{open.length} відкритих завдань</p></div><label><input type="checkbox" checked={showClosed} onChange={e=>setShowClosed(e.target.checked)}/> Показати виконані</label></div>
    {error&&<div role="alert" className="alert error">{error}</div>}
    {loading?<p>Завантажуємо справи…</p>:!shown.length?<p>Незавершених справ немає.</p>:<div className="handover-items">
      {shown.map(item=><article className={`handover-item handover-${item.priority}`} key={item.id}>
       <div className="handover-item-head"><strong>{labels[item.priority]||item.priority}</strong><small>{states[item.state]||item.state}</small></div>
       <p>{item.summary}</p><small>Зміна {item.shift_date} · {item.created_by} · {String(item.created_at).replace('T',' ').slice(0,16)}</small>
       {item.state==='resolved'?<small>Виконав: {item.resolved_by||'—'}</small>:
       <button type="button" className="button secondary" disabled={busy||loading} onClick={()=>resolve(item.id)}>Позначити виконаним</button>}
      </article>)}
    </div>}
   </div>
  </div>
 </section>;
}
