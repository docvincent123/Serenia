import React,{useEffect,useState} from 'react';

// Centre templates are plain text. Signed patient documents remain independent snapshots.
export default function DocumentTemplateSettings({api}){
 const [items,setItems]=useState([]),[title,setTitle]=useState(''),[content,setContent]=useState('');
 const [editing,setEditing]=useState(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 async function load(){
  try{setItems(await api('GET','/api/document-templates'));}catch(e){setMessage(e.message);}
 }
 useEffect(()=>{void load();},[]);
 async function submit(e){
  e.preventDefault();if(busy)return;setBusy(true);setMessage('');
  try{
   if(editing)await api('PATCH','/api/document-templates/'+editing,{title,content});
   else await api('POST','/api/document-templates',{title,content});
   setEditing(null);setTitle('');setContent('');await load();setMessage('Шаблон збережено.');
  }catch(e){setMessage(e.message);}finally{setBusy(false);}
 }
 async function toggle(item){
  setBusy(true);setMessage('');
  try{await api('PATCH','/api/document-templates/'+item.id,{active:!item.active});await load();}
  catch(e){setMessage(e.message);}finally{setBusy(false);}
 }
 return <section className="surface settings-panel" aria-label="Шаблони документів центру">
  <div className="section-head"><div><div className="eyebrow">КОНСТРУКТОР ФОРМ</div><h2>Шаблони документів</h2><p>Створені тут тексти доступні в картці пацієнта на ПК та Android.</p></div></div>
  {message&&<p role="status">{message}</p>}
  <form className="rehab-form" onSubmit={submit}>
   <h3>{editing?'Редагування шаблону':'Новий шаблон'}</h3>
   <label>Назва шаблону<input required maxLength={200} value={title} onChange={e=>setTitle(e.target.value)}/></label>
   <label>Затверджений текст<textarea required rows={6} maxLength={30000} value={content} onChange={e=>setContent(e.target.value)} placeholder="Текст документа. Можна використати {{patient_name}}, {{patient_no}} та {{today}}."/></label>
   <p>Підстановки: {"{{patient_name}}"} — ПІБ, {"{{patient_no}}"} — номер картки, {"{{today}}"} — поточна дата. Перевірте формулювання перед затвердженням і підписанням.</p>
   <div className="form-actions">{editing&&<button type="button" className="button secondary" onClick={()=>{setEditing(null);setTitle('');setContent('');}}>Скасувати</button>}<button className="button primary" type="submit" disabled={busy}>{editing?'Зберегти зміни':'Створити шаблон'}</button></div>
  </form>
  <div className="rehab-goals">{items.map(item=><article className="rehab-goal" key={item.id}>
   <div className="rehab-goal-head"><strong>{item.title}</strong><span className="rehab-goal-state">{item.active?'Активний':'Вимкнений'}</span></div>
   <p>{item.content.slice(0,180)}{item.content.length>180?'…':''}</p>
   <div className="row-actions">
    <button type="button" className="button secondary" onClick={()=>{setEditing(item.id);setTitle(item.title);setContent(item.content);}}>Редагувати</button>
    <button type="button" className="button secondary" onClick={()=>toggle(item)} disabled={busy}>{item.active?'Вимкнути':'Увімкнути'}</button>
   </div>
  </article>)}{!items.length&&<p>Шаблонів ще немає.</p>}</div>
 </section>;
}
