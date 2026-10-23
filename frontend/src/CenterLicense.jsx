import React,{useEffect,useState} from 'react';
export default function CenterLicense({api}) {
 const [status,setStatus]=useState(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
 async function load(){try{setStatus(await api('GET','/api/license'));}catch(e){setMessage(e.message);}}
 useEffect(()=>{load();},[]);
 async function activate(file){if(!file)return;setBusy(true);setMessage('');try{
  if(file.size>32768)throw new Error('Файл ліцензії завеликий.');
  await api('POST','/api/license',JSON.parse(await file.text()));await load();setMessage('Право користування підтверджено.');
 }catch(e){setMessage(e.message);}finally{setBusy(false);}}
 const labels={unmanaged:'Ліцензування ще не налаштоване видавцем',activation_required:'Потрібна активація',active:'Право користування активне',expired:'Строк користування завершився',invalid:'Ліцензія потребує перевірки'};
 return <section className="surface settings-panel"><h2>Право користування SOLVIA</h2>
 <p>{status?labels[status.status]:'Завантаження…'}</p>
 {status&&<><p>Ідентифікатор сервера: <code style={{overflowWrap:'anywhere'}}>{status.server_id}</code></p>
 {status.center&&<p>{status.center} · до {new Date(status.expires_at*1000).toLocaleString('uk-UA')}</p>}
 {!status.write_allowed&&<p>Перегляд даних доступний. Для внесення змін поновіть ліцензію.</p>}</>}
 <label>Відкрити файл ліцензії <input type="file" accept=".solvia-license,.json" disabled={busy} onChange={e=>{activate(e.target.files?.[0]);e.target.value='';}}/></label>
 {message&&<p role="status">{message}</p>}</section>;
}
