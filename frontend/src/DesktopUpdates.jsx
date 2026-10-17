import React,{useEffect,useState} from 'react';
import pkg from '../package.json';
import {cleanBase} from './connection.mjs';
import {PC_PACKAGE_LIMIT,newerVersion,pcPlatform,packageHash,checkedPackage} from './pc-updates.mjs';

export function DesktopReleaseSettings({api}){
  const [platform,setPlatform]=useState('windows'),[version,setVersion]=useState(pkg.version),[notes,setNotes]=useState(''),[file,setFile]=useState(null),[current,setCurrent]=useState([]),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const load=()=>api('GET','/api/desktop-updates').then(x=>setCurrent(Array.isArray(x)?x:[]));
  useEffect(()=>{load().catch(e=>setMessage(e.message));},[]);
  async function publish(e){e.preventDefault();if(busy)return;setBusy(true);setMessage('');try{
    if(!file||file.size>PC_PACKAGE_LIMIT)throw new Error('Оберіть інсталятор до 32 МБ.');
    if(platform==='windows'?!/\.exe$/i.test(file.name):!/\.tar\.gz$/i.test(file.name))throw new Error('Windows: EXE-інсталятор. Linux: пакет tar.gz із install-client.sh.');
    const sha256=await packageHash(await file.arrayBuffer());
    const encoded=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error('Не вдалося прочитати файл.'));reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.readAsDataURL(file);});
    await api('POST','/api/desktop-updates',{platform,version,sha256,package_base64:encoded,release_notes:notes});
    await load();setMessage('Оновлення опубліковано. ПК цієї платформи перевірять його протягом хвилини.');
  }catch(e){setMessage(e.message);}finally{setBusy(false);}}
  async function withdraw(target){if(!window.confirm('Прибрати це оновлення з роздачі?'))return;try{await api('DELETE','/api/desktop-updates?platform='+target,{});await load();setMessage('Оновлення знято з роздачі.');}catch(e){setMessage(e.message);}}
  return <section className="surface settings-panel"><h2>Оновлення програм на ПК</h2><p>Завантажте перевірений інсталятор SOLVIA один раз. Працівники завантажать його із сервера центру, без інтернету на їхніх ПК.</p>
    <p>Windows: EXE з цієї збірки. Linux: tar.gz з install-client.sh; на робочому місці запускайте саме install-client.sh, щоб оновити клієнт.</p>
    <form className="form-grid" onSubmit={publish}>
      <div className="field"><label>Платформа<select aria-label="Платформа оновлення ПК" value={platform} disabled={busy} onChange={e=>{setPlatform(e.target.value);setFile(null);}}><option value="windows">Windows</option><option value="linux">Linux</option></select></label></div>
      <div className="field"><label>Версія<input aria-label="Версія оновлення ПК" required pattern="[0-9]+\.[0-9]+\.[0-9]+" value={version} disabled={busy} onChange={e=>setVersion(e.target.value)} placeholder="2.5.2" /></label></div>
      <div className="field full"><label>Пакет оновлення<input key={platform} aria-label="Пакет оновлення ПК" type="file" accept={platform==='windows'?'.exe':'.tar.gz'} disabled={busy} onChange={e=>setFile(e.target.files[0]||null)} /></label></div>
      <div className="field full"><label>Що змінилося<textarea aria-label="Опис оновлення ПК" maxLength={3000} value={notes} disabled={busy} onChange={e=>setNotes(e.target.value)} /></label></div>
      <button className="button" type="submit" disabled={busy}>{busy?'Завантажуємо…':'Опублікувати оновлення ПК'}</button>
    </form>{message&&<p role="status">{message}</p>}
    {current.map(item=><div className="alert" key={item.platform}><strong>{item.platform==='windows'?'Windows':'Linux'} · {item.version}</strong><p>{item.filename} · {(item.size_bytes/1024/1024).toFixed(1)} МБ</p><button className="button secondary" onClick={()=>withdraw(item.platform)}>Зняти з роздачі</button></div>)}
  </section>;
}

export function DesktopUpdateNotice({api,base,token}){
  const platform=pcPlatform(navigator,Boolean(window.chrome?.webview));
  const [release,setRelease]=useState(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[hidden,setHidden]=useState('');
  useEffect(()=>{if(!platform)return;let alive=true,running=false;
    async function check(){if(running||document.hidden)return;running=true;try{const item=await api('GET','/api/desktop-updates?platform='+platform);if(alive)setRelease(item.available&&newerVersion(item.version,pkg.version)?item:null);}catch{}finally{running=false;}}
    void check();const timer=setInterval(check,60000);window.addEventListener('focus',check);
    return()=>{alive=false;clearInterval(timer);window.removeEventListener('focus',check);};
  },[base,platform]);
  async function download(){setBusy(true);setMessage('Перевіряємо пакет…');try{
    const response=await fetch(`${cleanBase(base)}/api/desktop-updates/package?platform=${platform}&sha=${release.sha256}`,{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(120000),redirect:'error'});
    const bytes=await checkedPackage(response,release);const url=URL.createObjectURL(new Blob([bytes],{type:platform==='windows'?'application/vnd.microsoft.portable-executable':'application/gzip'}));
    const link=document.createElement('a');link.href=url;link.download=release.filename;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
    setMessage(platform==='windows'?'Файл перевірено. Збережіть його, закрийте SOLVIA та запустіть EXE-інсталятор поверх наявної програми.':'Файл перевірено. Збережіть і розпакуйте архів, закрийте SOLVIA та виконайте в його папці: sudo bash install-client.sh');
  }catch(e){setMessage(e.message);}finally{setBusy(false);}}
  if(!release||hidden===release.sha256)return null;
  return <aside role="region" aria-label="Оновлення SOLVIA на ПК" className="pc-update-notice"><strong>Доступна SOLVIA {release.version}</strong><p>Цей ПК: {pkg.version} · {platform==='windows'?'Windows':'Linux'}</p>{release.release_notes&&<p>{release.release_notes}</p>}<button className="button" disabled={busy} onClick={download}>{busy?'Завантажуємо…':'Завантажити оновлення'}</button> <button className="button secondary" disabled={busy} onClick={()=>setHidden(release.sha256)}>Пізніше</button>{message&&<p role="status">{message}</p>}</aside>;
}
