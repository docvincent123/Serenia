import React, {useEffect,useState,useRef} from 'react';
import {createRoot} from 'react-dom/client';
import {TV_KEY,pageEntries,liveCalls,serverClock,tvChanges} from './model.mjs';
import './tv.css';
import {EventSound} from '../workflow-events.mjs';

async function call(path,token,method='GET') {
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),8000);
  try {
    const response=await fetch(path,{method,cache:'no-store',signal:abort.signal,
      headers:{...(token?{Authorization:'Bearer '+token}:{}),...(method==='POST'?{'Content-Type':'application/json'}:{})},
      ...(method==='POST'?{body:'{}'}:{})});
    const data=await response.json();
    if(!response.ok)throw Object.assign(new Error(data.error||'Помилка підключення'),{status:response.status});
    return data;
  } finally {clearTimeout(timer);}
}
function savedKey(){try{return localStorage.getItem(TV_KEY)||'';}catch{return '';}}
function saveKey(value){try{value?localStorage.setItem(TV_KEY,value):localStorage.removeItem(TV_KEY);}catch{}}
function TV(){
  const [token,setToken]=useState(savedKey),[pair,setPair]=useState(null),[snapshot,setSnapshot]=useState(null),
    [problem,setProblem]=useState(''),[tick,setTick]=useState(Date.now()),[received,setReceived]=useState(0),
    [page,setPage]=useState(0),[size,setSize]=useState(3),[busy,setBusy]=useState(false);
  const scheduleRef=useRef(null),previous=useRef(null),sound=useRef(null),flashTimer=useRef(null);
  const [soundOn,setSoundOn]=useState(false),[flash,setFlash]=useState('');
  useEffect(()=>{sound.current=new EventSound();return()=>{sound.current?.close();clearTimeout(flashTimer.current);};},[]);
  async function toggleSound(){if(soundOn){sound.current?.close();setSoundOn(false);return;}try{const ready=await sound.current?.enable();setSoundOn(Boolean(ready));if(ready)sound.current.play('call');}catch{setSoundOn(false);}}
  useEffect(()=>{if(!snapshot){previous.current=null;return;}const changes=tvChanges(previous.current,snapshot);previous.current=snapshot;
   if(changes.length){const called=changes.some(c=>c.kind==='call');sound.current?.play(called?'call':'event');setFlash(called?'Запрошуємо до кабінету':changes.some(c=>c.kind==='arrival')?'Пацієнт прибув':'Новий запис у розкладі');clearTimeout(flashTimer.current);flashTimer.current=setTimeout(()=>setFlash(''),7000);}
  },[snapshot]);
  const calls=snapshot?liveCalls(snapshot.entries):[];
  useEffect(()=>{
    const element=scheduleRef.current;if(!element)return;
    const measure=()=>{const title=element.querySelector('.tv-section-title'),columns=element.querySelector('.tv-columns');
      setSize(Math.max(1,Math.min(10,Math.floor((element.clientHeight-(title?.offsetHeight||0)-(columns?.offsetHeight||0)-20)/100))));};
    measure();const observer=window.ResizeObserver?new ResizeObserver(measure):null;observer?.observe(element);
    window.addEventListener('resize',measure);return()=>{observer?.disconnect();window.removeEventListener('resize',measure);};
  },[!!snapshot,calls.length]);
  const displayed=pageEntries(snapshot?.entries||[],page,size);
  useEffect(()=>{const timer=setInterval(()=>setTick(Date.now()),1000);return()=>clearInterval(timer);},[]);
  useEffect(()=>{setPage(0);const timer=setInterval(()=>setPage(x=>x+1),(snapshot?.page_seconds||12)*1000);return()=>clearInterval(timer);},[snapshot?.page_seconds,snapshot?.date,size]);
  useEffect(()=>{
    if(!token)return;
    let alive=true,timer;
    const offline=()=>{if(alive){setSnapshot(null);setProblem('З’єднання із сервером втрачено');}};
    async function poll(){
      try {
        if(pair){const state=await call('/api/tv/pairing',token);if(!alive)return;if(!state.paired){timer=setTimeout(poll,3000);return;}setPair(null);}
        const data=await call('/api/tv/schedule',token);if(!alive)return;
        setReceived(Date.now());setSnapshot(data);setProblem('');
      } catch(error){
        if(!alive)return;setSnapshot(null);
        if(error.status===401){saveKey('');setToken('');setPair(null);setProblem('Підключіть табло повторно');return;}
        setProblem(error.status===403?'Табло призупинено адміністратором':'З’єднання із сервером втрачено');
      }
      if(alive)timer=setTimeout(poll,5000);
    }
    poll();window.addEventListener('offline',offline);
    return()=>{alive=false;clearTimeout(timer);window.removeEventListener('offline',offline);};
  },[token,pair?.code]);
  // Do not leave yesterday's names on screen while the first request of the new day is pending.
  const clock=snapshot?serverClock(snapshot,received,tick):null;
  const sameDay=clock&&clock.toISOString().slice(0,10)===snapshot.date;
  async function connect(){if(busy)return;setBusy(true);setProblem('');try{
    const result=await call('/api/tv/pair','', 'POST');setPair({...result,expires:Date.now()+result.expires_in*1000});saveKey(result.token);setToken(result.token);
  }catch{setProblem('Сервер недоступний. Перевірте мережу та повторіть.');}finally{setBusy(false);}}
  const fullScreen=()=>document.documentElement.requestFullscreen?.().catch(()=>{});
  return <main className="tv-screen">
    <header className="tv-header"><div className="tv-brand"><span className="tv-logo"><img src="/solvia-icon.png" alt=""/></span><div><strong>SOLVIA<span>Табло прийому</span></strong><p>{snapshot?.center||'Центр психологічної допомоги'}</p></div></div>
      <div className="tv-clock">{clock&&sameDay?<><strong>{clock.toLocaleTimeString('uk-UA',{hour:'2-digit',minute:'2-digit',second:'2-digit',timeZone:'UTC'})}</strong><span>{clock.toLocaleDateString('uk-UA',{weekday:'long',day:'numeric',month:'long',timeZone:'UTC'})}</span></>:<span>Вітаємо в SOLVIA</span>}</div></header>
    {snapshot&&sameDay?<>
      {!!calls.length&&<section className="tv-call" aria-live="polite" key={calls.map(x=>x.called_at+':'+x.patient_id).join(',')}><div className="tv-call-label"><span className="tv-pulse"/>Запрошуємо<br/>до кабінету</div><div className="tv-called-patients">{calls.slice(0,2).map(x=><article key={x.appointment_id+':'+x.patient_id}><strong>{x.patient}</strong><span>{x.psychologist} <b>{x.room}</b></span></article>)}</div>{calls.length>2&&<small>Ще {calls.length-2} у списку ↓</small>}</section>}
      <section className="tv-schedule" ref={scheduleRef}><div className="tv-section-title"><h1>Записи до психологів</h1><span className="tv-live">Оновлюється автоматично</span></div>
        {snapshot.entries.length?<><div className="tv-columns"><span>Час</span><span>Пацієнт</span><span>Психолог</span><span>Кабінет</span><span>Статус</span></div>
          <div className="tv-rows" key={displayed.page+':'+snapshot.date}>{displayed.rows.map(x=><article className={'tv-row '+x.state} key={x.appointment_id+':'+x.patient_id}><time>{x.start.slice(11,16)}</time><strong>{x.patient}</strong><span>{x.psychologist}</span><b>{x.room}</b><span className="tv-state">{{called:'Запрошуємо',waiting:'Прибув',in_progress:'На консультації',scheduled:'Заплановано'}[x.state]}</span></article>)}</div>
        </>:<div className="tv-empty"><span>✓</span><h2>Наразі немає записів до показу</h2><p>Нові прийоми з’являться тут автоматично.</p></div>}
      </section>
      <footer className="tv-footer"><div className="tv-ticker"><b>Новини центру</b><div className="tv-ticker-window" aria-label={snapshot.message||'Вітаємо у центрі'}><div className="tv-ticker-track" style={{animationDuration:Math.max(24,(snapshot.message||'').length/4)+'s'}}>{[0,1].map(copy=><span key={copy} aria-hidden={copy===1?'true':undefined}>{(snapshot.message||'Будь ласка, очікуйте запрошення до кабінету. Дякуємо за довіру.').split('\n').filter(x=>x.trim()).join('   •   ')}<i>•</i></span>)}</div></div></div><span>SOLVIA · LemvoriLab{displayed.pages>1?` · ${displayed.page+1} / ${displayed.pages}`:''}</span></footer>
    </>:<section className="tv-setup" aria-live="polite">
      <span className="tv-setup-icon">{token&&!pair?'↻':'TV'}</span>
      <h1>{pair?'Підключення телевізора':token?'Очікуємо з’єднання':'Вітаємо на SOLVIA Табло'}</h1>
      {pair?<><p>У Server Console відкрийте «TV-табло»<br/>та введіть код із цього екрана.</p><strong className="tv-pair-code">{pair.code}</strong><p>{Math.max(0,Math.ceil((pair.expires-tick)/1000))>0?`Код діє ще ${Math.ceil((pair.expires-tick)/60000)} хв`:'Термін коду закінчився. Створіть новий код.'}</p></>:<p>{problem||(token?'Отримуємо актуальний розклад із сервера…':'Натисніть кнопку, щоб отримати код підключення.')}</p>}
      {pair&&problem&&<p role="alert">{problem}</p>}
      {(!token||pair&&tick>=pair.expires)&&<button disabled={busy} onClick={connect} autoFocus>{busy?'З’єднуємо…':'Отримати код підключення'}</button>}
      <p>SOLVIA · LemvoriLab</p>
    </section>}
    {flash&&<div className="tv-event-flash" role="status">{flash}</div>}
    <button className="tv-sound" aria-pressed={soundOn} onClick={toggleSound}>{soundOn?'Звук увімкнено':'Увімкнути звук'}</button>
    <button className="tv-fullscreen" onClick={fullScreen} aria-label="На весь екран" title="На весь екран">⛶</button>
  </main>;
}
createRoot(document.getElementById('root')).render(<TV/>);
