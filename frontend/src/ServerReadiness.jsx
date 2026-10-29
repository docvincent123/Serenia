import React,{useEffect,useState} from 'react';
import {backupNeedsAttention} from './backup-status.mjs';
import './server-readiness.css';

const gib=n=>Number.isFinite(Number(n))?`${(Number(n)/1073741824).toFixed(1)} ГБ`:'—';
export default function ServerReadiness({api}){
 const [data,setData]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true);
 useEffect(()=>{let live=true;
  async function load(){try{const result=await api('GET','/api/admin/system');if(live){setData(result);setError('');}}
    catch(e){if(live){setData(null);setError(e.message);}}finally{if(live)setLoading(false);}}
  void load();const timer=setInterval(()=>{if(!document.hidden)void load();},30000);
  return()=>{live=false;clearInterval(timer);};
 },[api]);
 const res=data?.host_resources||{},events=data?.backups||[];
 const latestLocal=events.find(x=>x.action==='backup');
 const latestRemote=events.find(x=>x.action==='offsite');
 const backupWarning=data&&backupNeedsAttention(events);
 const diskWarning=res.disk_available&&Number(res.disk_used_percent)>=90;
 const jobs=(data?.backup_jobs||[]).filter(x=>x.state==='pending'||x.state==='running'||x.state==='failed');
 return <section className="surface server-readiness" aria-label="Технічна готовність сервера">
  <header><div><div className="eyebrow">СЕРВЕР SOLVIA</div><h2>Технічний стан</h2><p>Ресурси Linux, копії та черга резервування. Дані оновлюються автоматично.</p></div></header>
  {loading&&<p>Читаємо стан сервера…</p>}
  {error&&<div role="alert" className="alert error">Діагностика недоступна: {error}</div>}
  {data&&<><div className="server-readiness-grid">
   <article><small>Диск сервера</small><strong>{res.disk_available?`${Math.round(Number(res.disk_used_percent))}% зайнято`:'Немає даних'}</strong><span>{res.disk_available?`${gib(res.disk_free_bytes)} вільно`:'Не вдалося визначити доступний обсяг'}</span></article>
   <article><small>Оперативна пам’ять</small><strong>{res.memory_available?gib(res.memory_total_bytes):'Немає даних'}</strong><span>{res.memory_available?`${gib(res.memory_free_bytes)} фізично вільно`:'Показник недоступний на цій ОС'}</span></article>
   <article><small>Навантаження / 1 хв</small><strong>{typeof res.load_1min==='number'?res.load_1min.toFixed(2):'Немає даних'}</strong><span>Середня черга Linux, не відсоток CPU</span></article>
   <article><small>PostgreSQL</small><strong>{data.database?.name||'—'}</strong><span>{data.database?.size||'—'} · {data.database?.version||'Версія невідома'}</span></article>
   <article><small>Черга API від запуску</small><strong>{data.api_timing?.max_wait_ms ?? '—'} мс</strong><span>Макс. очікування · {data.api_timing?.successful_requests??0} успішних запитів у цьому процесі</span></article>
   <article><small>Обробка API від запуску</small><strong>{data.api_timing?.max_processing_ms ?? '—'} мс</strong><span>Макс. час обробки успішного запиту; не p95</span></article>
  </div>
  <div className="server-readiness-warnings" role="status">
   {diskWarning&&<p className="server-warning">Диск заповнений щонайменше на 90%. Перевірте простір на сервері.</p>}
   {backupWarning&&<p className="server-warning">Немає підтвердженої свіжої локальної копії за останні 36 год або є помилка резервування.</p>}
   {!latestRemote&&<p className="server-warning">Віддалене резервування ще не підтверджено.</p>}
   {latestRemote?.status==='failed'&&<p className="server-warning">Останнє передавання на VPS завершилося помилкою.</p>}
   {jobs.some(x=>x.state==='failed')&&<p className="server-warning">Є невдалі завдання резервування зміни — потрібна перевірка.</p>}
   {!diskWarning&&!backupWarning&&latestRemote?.status==='success'&&!jobs.some(x=>x.state==='failed')&&<p>Не виявлено попереджень за доступними показниками. Це не перевірка доступності з іншої мережі.</p>}
  </div>
  <div className="server-readiness-backups">
   <p><strong>Локальна копія:</strong> {latestLocal?`${latestLocal.status} · ${String(latestLocal.created||'').replace('T',' ').slice(0,19)}`:'Ще не зафіксована'}</p>
   <p><strong>VPS:</strong> {latestRemote?`${latestRemote.status} · ${String(latestRemote.created||'').replace('T',' ').slice(0,19)}`:'Немає підтвердження доставки'}</p>
   <p><strong>Завдання копіювання зміни:</strong> {jobs.length?jobs.map(x=>`${x.shift_date} · ${x.state}`).join('; '):'Немає невиконаних завдань у поточній вибірці'}</p>
  </div></>}
 </section>;
}
