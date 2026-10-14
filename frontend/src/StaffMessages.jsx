import React,{useEffect,useRef,useState} from 'react';
export default function StaffMessages({api,initialRecipient='',initialDevice=''}) {
  const [people,setPeople]=useState([]),[messages,setMessages]=useState([]),[search,setSearch]=useState('');
  const [recipient,setRecipient]=useState(String(initialRecipient)),[device,setDevice]=useState(initialDevice);
  const [body,setBody]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const key=useRef(crypto.randomUUID()),lock=useRef(false),editor=useRef(null);
  useEffect(()=>{let alive=true;async function load(){try{const [p,m]=await Promise.all([api('GET','/api/staff/recipients'),api('GET','/api/staff/messages')]);if(alive){setPeople(p);setMessages(m);setError('');}}catch(e){if(alive)setError(e.message);}}load();const timer=setInterval(load,15000);return()=>{alive=false;clearInterval(timer);};},[api]);
  const person=people.find(p=>String(p.id)===recipient),history=messages.filter(m=>String(m.recipient_id)===recipient);
  function choose(p){if(lock.current)return;setRecipient(String(p.id));setDevice('');key.current=crypto.randomUUID();setNotice('');editor.current?.focus();}
  async function send(e){e.preventDefault();if(lock.current||!person||!body.trim())return;lock.current=true;setBusy(true);setError('');setNotice('');try{
    await api('POST','/api/staff/messages',{recipient_id:person.id,device_id:device,body:body.trim(),client_key:key.current});
    setBody('');key.current=crypto.randomUUID();setNotice('Збережено на сервері. Отримання підтвердить додаток психолога.');
    setMessages(await api('GET','/api/staff/messages'));
  }catch(e){setError(e.message);}finally{lock.current=false;setBusy(false);}}
  return <><div className="page-head"><div><div className="eyebrow">КОМАНДА НА ЗВ’ЯЗКУ</div><h1>Повідомлення психологам</h1><p>Оберіть працівника, його телефон і надішліть службове повідомлення.</p></div></div>
    {error&&<div className="alert error" role="alert">{error}</div>}
    <div className="staff-workspace"><aside className="surface staff-directory"><label>Пошук психолога<input aria-label="Пошук психолога" type="search" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Ім’я або телефон"/></label>
      <div className="staff-people">{people.filter(p=>(p.name+' '+p.phone).toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(p=><button disabled={busy} key={p.id} className={`staff-person ${recipient===String(p.id)?'selected':''}`} aria-pressed={recipient===String(p.id)} onClick={()=>choose(p)}><span className="staff-avatar" aria-hidden="true">{p.name.slice(0,1)}</span><span><strong>{p.name}</strong><small>{p.devices.some(d=>d.online)?'● Телефон на зв’язку':'○ Немає свіжого з’єднання'}</small></span></button>)}</div>
      {!people.length&&<p>Активних психологів ще немає.</p>}
    </aside><section className="surface staff-conversation">{!person?<div className="staff-empty"><h2>Зв’язок із командою</h2><p>Оберіть психолога зі списку ліворуч.</p></div>:<>
      <header className="staff-chat-head"><div><h2>{person.name}</h2><p>{person.phone||'Номер телефону не вказано'}</p></div><span className="badge">{person.devices.length} пристроїв</span></header>
      <div className="staff-history" aria-label="Історія надісланих повідомлень">{!history.length?<p className="staff-empty">Ви ще не надсилали повідомлень цьому психологу.</p>:history.map(m=><article className="staff-bubble" key={m.id}><p>{m.body}</p><small>{m.created?.replace('T',' ')} · {m.device_id?'Обраний телефон':'Усі пристрої психолога'}</small><span className={`staff-receipt ${m.read_at?'read':''}`}>{m.read_at?'✓✓ Прочитано':m.delivered_at?'✓ Отримано додатком':'Очікує отримання'}</span></article>)}</div>
      <form className="staff-compose" onSubmit={send}><label>Куди надіслати<select aria-label="Куди надіслати" disabled={busy} value={device} onChange={e=>{setDevice(e.target.value);key.current=crypto.randomUUID();}}><option value="">Усі пристрої психолога</option>{person.devices.map(d=><option key={d.device_id} value={d.device_id}>{d.device_name} · {d.online?'на зв’язку':'неактивний'}</option>)}</select></label>
      <div className="staff-templates">{['Пацієнт прибув.','Зверніться, будь ласка, до реєстратури.','Перевірте зміни у розкладі.'].map(t=><button disabled={busy} type="button" key={t} onClick={()=>{setBody(t);key.current=crypto.randomUUID();editor.current?.focus();}}>{t}</button>)}</div>
      <label>Повідомлення<textarea aria-label="Повідомлення" ref={editor} required maxLength={1000} rows={3} disabled={busy} value={body} onChange={e=>{setBody(e.target.value);key.current=crypto.randomUUID();}} placeholder="Напишіть повідомлення психологу…"/></label>
      <div className="staff-compose-footer"><small>{body.length}/1000 · Доставка після підключення додатка</small><button className="button primary" disabled={busy||!body.trim()}>{busy?'Надсилання…':'Надіслати повідомлення'}</button></div>{notice&&<p role="status">{notice}</p>}
      </form></>}</section></div></>;
}
