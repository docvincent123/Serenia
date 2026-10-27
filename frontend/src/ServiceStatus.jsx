import React,{useEffect,useState} from 'react';
import {cleanBase} from './connection.mjs';
import './service-status.css';

// Keep the workspace mounted: an update must not discard an open form or draft.
export function ServiceStatus({base,enabled}){
 const [state,setState]=useState(null),[offline,setOffline]=useState(false),[hidden,setHidden]=useState(false),[clock,setClock]=useState(Date.now());
 const [retry,setRetry]=useState(0);
 useEffect(()=>{
  if(!enabled)return;
  let alive=true,timer,failures=0;const abort=new AbortController();
  async function poll(){
   let delay=15000;
   try{
    const response=await fetch(cleanBase(base)+'/api/client-status',{cache:'no-store',redirect:'error',signal:AbortSignal.any([abort.signal,AbortSignal.timeout(6000)])});
    if(response.status===404)return; // Older server: do not invent an update state.
    if(!response.ok)throw Error('Unavailable');
    const data=await response.json();if(!['ready','maintenance'].includes(data.mode))return;
    if(alive){failures=0;setOffline(false);setState(data);if(data.mode==='ready')setHidden(false);}
    if(data.mode==='maintenance')delay=5000;
   }catch{if(alive&&++failures>=2){setOffline(true);delay=5000;}}
   finally{if(alive)timer=setTimeout(poll,delay);}
  }
  void poll();return()=>{alive=false;abort.abort();clearTimeout(timer);};
 },[base,enabled,retry]);
 useEffect(()=>{const timer=setInterval(()=>setClock(Date.now()),1000);return()=>clearInterval(timer);},[]);
 const maintenance=state?.mode==='maintenance';
 if(!enabled||(!maintenance&&!offline))return null;
 const remaining=state?.expected_until?Math.max(0,state.expected_until-Math.floor(clock/1000)):null;
 const title=maintenance?'Сервер на оновленні':'Немає зв’язку із сервером';
 if(hidden)return <button className="service-status-pill" onClick={()=>setHidden(false)}>{title} · Деталі</button>;
 return <div className="service-status-overlay"><section className="service-status-card" role="dialog" aria-modal="true" aria-labelledby="service-status-title">
  <div className="service-orbit" aria-hidden="true"><span/><span/><span/></div>
  <h2 id="service-status-title">{title}</h2>
  <p role="status">{maintenance?(state.message||'Адміністратор оновлює програму. Підключення відновиться автоматично.'):'Перевіряємо з’єднання автоматично. Відкриті форми залишаються на цьому пристрої.'}</p>
  {maintenance&&<p className="service-eta">{remaining===null?'Час завершення ще не вказаний.':remaining>0?`Орієнтовно залишилось ${Math.ceil(remaining/60)} хв`:'Оновлення триває довше запланованого. Очікуємо підтвердження сервера.'}</p>}
  <small>Перед закриттям програми збережіть введений текст у локальній чернетці.</small>
  <div><button className="button" onClick={()=>{setRetry(n=>n+1);setHidden(false);}}>Перевірити зараз</button><button className="button secondary" onClick={()=>setHidden(true)}>Згорнути повідомлення</button></div>
 </section></div>;
}
export function ServiceControls({api}){
 const [mode,setMode]=useState('ready'),[minutes,setMinutes]=useState(15),[message,setMessage]=useState('Оновлюємо SOLVIA. Дочекайтеся відновлення підключення.'),[result,setResult]=useState(''),[busy,setBusy]=useState(false);
 async function change(next){setBusy(true);setResult('');try{
  const data=await api('POST','/api/admin/service-state',{mode:next,message:next==='maintenance'?message:'',expected_until:next==='maintenance'?Math.floor(Date.now()/1000)+Number(minutes)*60:0});
  setMode(data.mode);setResult(next==='ready'?'Роботу відновлено.':'Усі підключені пристрої отримають повідомлення. Запис на сервер тимчасово призупинено.');
 }catch(e){setResult(e.message);}finally{setBusy(false);}}
 useEffect(()=>{api('GET','/api/admin/service-state').then(d=>setMode(d.mode)).catch(()=>{});},[]);
 return <details className="surface service-controls"><summary>Обслуговування та повідомлення пристроям</summary><p>Стан: {mode==='ready'?'Робота дозволена':'Обслуговування'}. Пристрої перевіряють стан автоматично.</p>
 <label>Повідомлення працівникам<input aria-label="Повідомлення про обслуговування" maxLength={300} value={message} onChange={e=>setMessage(e.target.value)}/></label>
 <label>Орієнтовна тривалість, хв<input aria-label="Тривалість обслуговування" type="number" min="1" max="1440" value={minutes} onChange={e=>setMinutes(e.target.value)}/></label>
 <button className="button secondary" disabled={busy||!Number.isInteger(Number(minutes))||minutes<1||minutes>1440} onClick={()=>change('maintenance')}>Почати обслуговування</button> <button className="button" disabled={busy} onClick={()=>change('ready')}>Відновити роботу</button>{result&&<p role="status">{result}</p>}</details>;
}
