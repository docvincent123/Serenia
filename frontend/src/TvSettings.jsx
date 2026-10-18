import React,{useEffect,useState} from 'react';

const defaults={name:'Телевізор у холі',code:'',room_id:0,message:'Будь ласка, очікуйте запрошення до кабінету.',page_seconds:12,show_full_names:true,enabled:true};
export function TvCallPanel({api}){
  const [rows,setRows]=useState([]),[error,setError]=useState(''),[busy,setBusy]=useState('');
  const load=()=>api('GET','/api/tv/candidates').then(data=>{setRows(data);setError('');});
  useEffect(()=>{let alive=true;const refresh=()=>{if(alive)load().catch(e=>alive&&setError(e.message));};refresh();const timer=setInterval(refresh,10000);return()=>{alive=false;clearInterval(timer);};},[api]);
  async function invite(row,remove=false){const key=row.appointment_id+':'+row.patient_id;setBusy(key);try{
    await api(remove?'DELETE':'POST','/api/tv/call',{appointment_id:row.appointment_id,patient_id:row.patient_id});await load();
  }catch(e){setError(e.message);}finally{setBusy('');}}
  return <section className="surface settings-panel tv-control-panel"><h2>Виклик на TV-табло</h2><p>Спочатку відмітьте прибуття пацієнта у прийомах. Кнопка «Запросити» виділяє пацієнта на табло на 2 хвилини.</p>
    {error&&<p className="alert error" role="alert">{error}</p>}
    {!rows.length?<p>Сьогодні немає доступних записів.</p>:<div className="tv-operator-list">{rows.map(row=><article key={row.appointment_id+':'+row.patient_id}><time>{row.start.slice(11,16)}</time><div><strong>{row.patient}</strong><span>{row.psychologist} · {row.room}</span></div><span>{row.started_at?'На консультації':row.called_at?'Запрошено':row.arrived_at?'Прибув':'Очікуємо прибуття'}</span><button className="button primary" disabled={!!busy||!row.arrived_at||!!row.started_at} onClick={()=>invite(row)}>{row.called_at?'Запросити ще раз':'Запросити'}</button>{!!row.called_at&&<button className="button secondary" disabled={!!busy} onClick={()=>invite(row,true)}>Прибрати виклик</button>}</article>)}</div>}
  </section>;
}
export default function TvSettings({api,apiBase}){
  const [devices,setDevices]=useState([]),[rooms,setRooms]=useState([]),[form,setForm]=useState(defaults),[selected,setSelected]=useState(null),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
  const load=()=>Promise.all([api('GET','/api/admin/tv-displays'),api('GET','/api/rooms')]).then(([screens,locations])=>{setDevices(screens);setRooms(locations);});
  useEffect(()=>{load().catch(e=>setMessage(e.message));},[api]);
  const update=(key,value)=>setForm(old=>({...old,[key]:value}));
  async function save(event){event.preventDefault();setBusy(true);setMessage('');try{
    await api(selected?'PATCH':'POST','/api/admin/tv-displays'+(selected?'/'+selected:''),{...form,room_id:Number(form.room_id),page_seconds:Number(form.page_seconds)});
    await load();setForm(defaults);setSelected(null);setMessage(selected?'Налаштування табло збережено.':'Телевізор підключено. Розклад з’явиться протягом 5 секунд.');
  }catch(e){setMessage(e.message);}finally{setBusy(false);}}
  async function revoke(device){if(!window.confirm(`Відключити «${device.name}»? Для повторного доступу знадобиться новий код.`))return;try{await api('DELETE','/api/admin/tv-displays/'+device.id,{});await load();if(selected===device.id){setSelected(null);setForm(defaults);}}catch(e){setMessage(e.message);}}
  const tvUrl=apiBase.replace(/\/$/,'')+'/tv';
  return <><section className="surface settings-panel tv-control-panel"><h2>TV-табло</h2><p>На телевізорі в мережі центру відкрийте цю адресу. Натисніть «Отримати код підключення» та введіть 6 цифр нижче.</p><p className="tv-address"><code>{tvUrl}</code></p><p>Табло показує лише розклад і виклики. Рухома стрічка «Новини центру» внизу екрана оновлюється звідси. Кожне оголошення впишіть з нового рядка.</p>
    <div className="tv-device-grid">{devices.map(device=><article className="tv-device" key={device.id}><strong>{device.name}</strong><span>{device.enabled?'Увімкнено':'Призупинено'} · {device.room_id?(rooms.find(r=>r.id===device.room_id)?.name||'Обраний кабінет'):'Усі кабінети'}</span><small>Останній зв’язок: {device.last_seen?.replace('T',' ')||'очікуємо телевізор'}</small><div className="page-actions"><button className="button secondary" onClick={()=>{setSelected(device.id);setForm({...device,code:''});setMessage('');}}>Налаштувати</button><button className="button danger" onClick={()=>revoke(device)}>Відключити</button></div></article>)}</div>
    <h3>{selected?'Налаштування телевізора':'Підключити телевізор'}</h3><form className="form-grid" onSubmit={save}>
      {!selected&&<label className="field">Код із телевізора<input required inputMode="numeric" pattern="[0-9]{6}" maxLength={6} autoComplete="off" value={form.code} onChange={e=>update('code',e.target.value.replace(/\D/g,''))}/></label>}
      <label className="field">Назва телевізора<input required maxLength={60} value={form.name} onChange={e=>update('name',e.target.value)}/></label>
      <label className="field">Кабінети<select value={form.room_id||0} onChange={e=>update('room_id',Number(e.target.value))}><option value={0}>Усі кабінети</option>{rooms.filter(r=>r.active!==false).map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
      <label className="field">Зміна сторінки, секунд<input required type="number" min={6} max={60} value={form.page_seconds} onChange={e=>update('page_seconds',e.target.value)}/></label>
      <label className="field">Імена пацієнтів<select value={form.show_full_names?'full':'short'} onChange={e=>update('show_full_names',e.target.value==='full')}><option value="full">Повне ПІБ</option><option value="short">Прізвище та ініціали</option></select></label>
      <label className="field">Стан<select value={form.enabled?'on':'off'} onChange={e=>update('enabled',e.target.value==='on')}><option value="on">Увімкнено</option><option value="off">Призупинено</option></select></label>
      <label className="field full">Новини та оголошення центру<textarea maxLength={450} rows={4} placeholder="Кожне оголошення — з нового рядка" value={form.message} onChange={e=>update('message',e.target.value)}/></label>
      <div className="page-actions"><button className="button primary" disabled={busy} type="submit">{busy?'Зберігаємо…':selected?'Зберегти табло':'Підключити табло'}</button>{selected&&<button className="button secondary" type="button" onClick={()=>{setSelected(null);setForm(defaults);}}>Додати інший телевізор</button>}</div>
    </form>{message&&<p role="status" className="alert info">{message}</p>}
  </section><TvCallPanel api={api}/></>;
}
