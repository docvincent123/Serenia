const q=id=>document.getElementById(id);
let csrf='';
const notice=(message,error=false)=>{q('notice').textContent=message;q('notice').className=error?'error':'';};
async function api(path,method='GET',body){
 const response=await fetch(path,{method,credentials:'same-origin',headers:{...(body?{'Content-Type':'application/json'}:{}),...(csrf?{'X-CSRF':csrf}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const data=await response.json();
 if(!response.ok)throw new Error(data.error||'Запит не виконано');
 return data;
}
function renderSession(user){
 q('login-panel').hidden=Boolean(user);q('dashboard').hidden=!user;
 q('operator-label').textContent=user||'Оператор';q('logout').hidden=!user;
}
function badge(label,ok=false,warn=false){const e=document.createElement('span');e.className='chip'+(ok?' ok':warn?' warn':'');e.textContent=label;return e;}
function cell(row,text,sub){
 const td=document.createElement('td');
 const strong=document.createElement('strong');strong.textContent=text;td.append(strong);
 if(sub){const small=document.createElement('small');small.textContent=sub;td.append(small);}
 row.append(td);return td;
}
function online(item){return item.last_seen&&Date.now()-Date.parse(item.last_seen)<15*60*1000;}
async function reload(){
 const data=await api('/api/centers');const items=data.centers||[];
 q('center-count').textContent=items.length;
 q('online-count').textContent=items.filter(online).length;
 q('backup-count').textContent=items.filter(x=>x.backup_status!=='ok').length;
 q('empty').hidden=items.length>0;
 const body=q('centers');body.replaceChildren();
 for(const item of items){
  const tr=document.createElement('tr');
  cell(tr,item.name,item.city||item.id);
  cell(tr,item.version||'—',item.server_id.slice(0,12)+'…');
  const status=document.createElement('td');status.append(badge(online(item)?'На зв’язку':'Не в мережі',Boolean(online(item))));tr.append(status);
  const copy=document.createElement('td');copy.append(badge(item.backup_status==='ok'?'Копія передана':item.backup_status==='failed'?'Помилка копії':'Немає підтвердження',item.backup_status==='ok',item.backup_status==='failed'));
  if(item.last_backup_at){const when=document.createElement('small');when.textContent=item.last_backup_at;copy.append(when);}
  tr.append(copy);
  const control=document.createElement('td');const controls=document.createElement('div');controls.className='controls';
  const button=document.createElement('button');button.className='secondary';button.textContent=item.status==='active'?'Призупинити облік':'Активувати облік';
  button.onclick=async()=>{
   if(!confirm('Змінити статус у реєстрі компанії? Це не зупиняє медичний сервер.'))return;
   try{await api('/api/centers/'+item.id,'PATCH',{status:item.status==='active'?'paused':'active'});await reload();notice('Статус обліку змінено. Робота медичного сервера не зачеплена.');}catch(e){notice(e.message,true);}
  };
  controls.append(button);
  const rotate=document.createElement('button');rotate.className='secondary';rotate.textContent='Новий ключ';
  rotate.title='Скинути ключ технічного стану. Попередній перестане працювати.';
  rotate.onclick=async()=>{
    if(!confirm('Змінити ключ підключення '+item.name+'? Старий ключ перестане працювати, доки його не замінять на сервері центру.'))return;
    try{
      const data=await api('/api/centers/'+item.id+'/rotate-token','POST',{});
      q('token-box').hidden=false;q('new-token').textContent=data.center_token;
      notice('Створено новий ключ. Замініть його в /etc/solvia/operator-heartbeat-token центру.');
    }catch(e){notice(e.message,true);}
  };
  controls.append(rotate);control.append(controls);tr.append(control);body.append(tr);
 }
}
q('login-form').onsubmit=async event=>{
 event.preventDefault();try{
  const data=await api('/api/login','POST',{username:q('username').value,password:q('password').value});
  csrf=data.csrf;renderSession(q('username').value);q('password').value='';await reload();notice('Вхід виконано.');
 }catch(e){notice(e.message,true);}
};
q('center-form').onsubmit=async event=>{
 event.preventDefault();
 const fields=new FormData(event.target);
 try{
  const data=await api('/api/centers','POST',{name:String(fields.get('name')),city:String(fields.get('city')),server_id:String(fields.get('server_id'))});
  q('token-box').hidden=false;q('new-token').textContent=data.center_token;event.target.reset();
  await reload();notice('Центр зареєстровано. Збережіть одноразовий ключ.');
 }catch(e){notice(e.message,true);}
};
q('copy-token').onclick=async()=>{try{await navigator.clipboard.writeText(q('new-token').textContent);notice('Ключ скопійовано. Зберігайте його лише в захищеній конфігурації центру.');}catch{notice('Не вдалося скопіювати автоматично — виділіть текст вручну.',true);}};
q('reload').onclick=()=>reload().catch(e=>notice(e.message,true));
q('logout').onclick=async()=>{try{await api('/api/logout','POST',{});}catch{}csrf='';q('token-box').hidden=true;q('new-token').textContent='';renderSession('');notice('Ви вийшли з кабінету.');};
(async()=>{try{const s=await api('/api/session');csrf=s.csrf||'';renderSession(s.authenticated?s.operator:'');if(s.authenticated)await reload();}catch(e){notice(e.message,true);}})();
