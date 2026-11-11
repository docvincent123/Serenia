import React,{useEffect,useState} from 'react';
const categories=[
 ['psychology','Психологічна допомога'],
 ['medical','Медичні консультації'],
 ['rehabilitation','Реабілітація'],
 ['creative','Терапевтичні заняття'],
 ['other','Інший напрямок']
];
const categoryLabel=id=>categories.find(row=>row[0]===id)?.[1]||'Інший напрямок';
export default function CenterServices({api}){
  const [items,setItems]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  const [name,setName]=useState(''),[category,setCategory]=useState('psychology'),[showInactive,setShowInactive]=useState(false);
  const [editing,setEditing]=useState(null);
  async function load(){try{setItems(await api('GET','/api/services'));setError('');}catch(e){setError(e.message);}}
  useEffect(()=>{void load();},[]);
  async function submit(e){
    e.preventDefault();if(busy||!name.trim())return;setBusy(true);setError('');
    try{await api('POST','/api/services',{name:name.trim(),category});setName('');await load();}
    catch(e){setError(e.message);}finally{setBusy(false);}
  }
  async function update(item,changes){
    if(busy)return;setBusy(true);setError('');
    try{await api('PATCH',`/api/services/${item.id}`,changes);setEditing(null);await load();}
    catch(e){setError(e.message);}finally{setBusy(false);}
  }
  const visible=(items||[]).filter(x=>showInactive||x.active);
  return <section className="care-services">
    <header className="page-head"><div><div className="eyebrow">КЕРУВАННЯ ЦЕНТРОМ</div><h1>Напрямки допомоги</h1><p>Налаштовуйте послуги, які надає центр: психологія, психіатрія, фізична реабілітація, танцювально-рухова терапія та інші.</p></div></header>
    <p className="care-services-note">Напрямок — це категорія послуги, а не дозвіл на перегляд медичних даних. Доступ працівників і професійну кваліфікацію налаштовують окремо.</p>
    {error&&<div role="alert" className="alert error">{error}</div>}
    <div className="care-services-layout">
      <div className="care-services-list">
        <div className="care-services-toolbar"><strong>{items?visible.length:'…'} напрямків</strong><label><input type="checkbox" checked={showInactive} onChange={e=>setShowInactive(e.target.checked)}/> Показати неактивні</label></div>
        {items===null?<p role="status">Завантажуємо напрямки…</p>:!visible.length?<p>Напрямків поки немає.</p>:<div className="care-service-grid">
          {visible.map(item=><article className="care-service-card" key={item.id}>
            <div><span className="care-service-category">{categoryLabel(item.category)}</span><strong>{item.name}</strong><small>{item.active?'Доступний для центру':'Вимкнений'}</small></div>
            {editing===item.id?<form onSubmit={e=>{e.preventDefault();void update(item,{name:e.target.elements.serviceName.value.trim(),category:e.target.elements.serviceCategory.value});}}>
              <label>Назва<input name="serviceName" defaultValue={item.name} required maxLength={100}/></label>
              <label>Група<select name="serviceCategory" defaultValue={item.category}>{categories.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
              <div className="care-service-actions"><button className="button primary" disabled={busy} type="submit">Зберегти</button><button className="button secondary" type="button" onClick={()=>setEditing(null)}>Скасувати</button></div>
            </form>:<div className="care-service-actions"><button className="button secondary" type="button" onClick={()=>setEditing(item.id)}>Редагувати</button><button className="button secondary" type="button" disabled={busy} onClick={()=>update(item,{active:!item.active})}>{item.active?'Вимкнути':'Увімкнути'}</button></div>}
          </article>)}
        </div>}
      </div>
      <form className="care-services-form" onSubmit={submit}>
        <h2>Додати напрямок</h2><p>Назва з’явиться в довіднику центру.</p>
        <label>Назва<input placeholder="Наприклад, музикотерапія" value={name} onChange={e=>setName(e.target.value)} maxLength={100} required/></label>
        <label>Категорія<select value={category} onChange={e=>setCategory(e.target.value)}>{categories.map(([id,label])=><option key={id} value={id}>{label}</option>)}</select></label>
        <button className="button primary" type="submit" disabled={busy||!name.trim()}>{busy?'Зберігаємо…':'Додати напрямок'}</button>
      </form>
    </div>
  </section>;
}
