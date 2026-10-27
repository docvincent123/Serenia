// Role boundaries and the actual desktop bundle, with synthetic center data.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {createRequire} from 'node:module';
import {navFor,navigationGroups} from '../frontend/src/workspace-model.mjs';
const expected={admin:['dashboard','shift-workspace','calendar','waiting-list','patients','families','team','staff-messages','rooms','reports','discharges','workload','supervisions','archive','devices','settings','audit'],reception:['shift-workspace','calendar','waiting-list','patients','families','archive'],director:['dashboard','workload','supervisions','discharges','staff-messages'],psychologist:['calendar','patients','reports','supervisions']};
for(const [role,keys] of Object.entries(expected)){const nav=navFor(role).map(([key])=>key);assert.deepEqual(nav,keys,`Preserve every ${role} module and its order`);for(const key of nav.filter(key=>key!=='settings'))assert.equal(navigationGroups.filter(([, ,members])=>members.includes(key)).length,1,`Exactly one navigation group for ${key}`);}
assert.deepEqual(navFor('unknown'),[]);
const require=createRequire(import.meta.url),{chromium}=require(process.env.SOLVIA_PLAYWRIGHT_MODULE||'playwright');
const root=resolve('frontend/dist'),server=createServer(async(req,res)=>{try{const path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(path!==root&&!path.startsWith(root+'/')){res.writeHead(403).end();return;}const file=path===root?resolve(root,'index.html'):path;res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,...(process.env.SOLVIA_CHROMIUM_EXECUTABLE?{executablePath:process.env.SOLVIA_CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage']}:{})});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});await page.emulateMedia({reducedMotion:'reduce'});
  let role='admin';const errors=[],edits=[];page.on('pageerror',e=>errors.push(e.message));
  const p={id:10,patient_no:'12345',name:'Коваль Олена',phone:'+380671234567',dob:'1990-01-01',category:'Ветеран/ветеранка',psychologist_id:3,psychologist:'Марченко Оксана',status:'active',family_id:1,family:'Родина Коваль'};
  const p2={...p,id:11,name:'Бондар Андрій',patient_no:'23456',phone:'+380681234567',category:'Військовий/військова',family_id:null,family:''};
  const users=[{id:1,name:'Коваль Андрій',role:'admin',login:'admin',phone:'+380501234567',active:true,active_sessions:1,platforms:'Desktop'},{id:3,name:'Марченко Оксана',role:'psychologist',login:'oksana',phone:'+380501234568',active:true,active_sessions:1,platforms:'Android'}];
  const rooms=[{id:2,name:'Кабінет 101',code:'101',capacity:2,type:'individual',active:true,description:'Індивідуальні консультації'},{id:4,name:'Зала групової роботи',code:'201',capacity:12,type:'group',active:false,description:'Групові заняття'}];
  const stats={total_patients:86,active_patients:32,archived_patients:54,new_patients:8,consultations:124,avg_duration_minutes:52,active_courses:28,completed_courses:12,signed_documents:64,outgoing_referrals:9,supervisions_completed:6,appointments:{no_show:3},categories:[{category:'Ветеран/ветеранка',n:38},{category:'Військовий/військова',n:32},{category:'Партнер/партнерка',n:16}],referral_sources:[{source:'Військова частина',n:34},{source:'Самозвернення',n:28}],load:[{name:'Марченко Оксана',appointments:18,hours:16},{name:'Литвин Максим',appointments:14,hours:12},{name:'Кравчук Ірина',appointments:10,hours:8}]};
  const meta={psychologists:users.filter(u=>u.role==='psychologist'),rooms:rooms.filter(r=>r.active),categories:['Військовий/військова','Ветеран/ветеранка'],workflow:{opening_time:'08:00',closing_time:'20:00',working_days:'1234567',default_duration_minutes:60}};
  await page.addInitScript(()=>sessionStorage.setItem('solvia_token','synthetic-design'));
  let conflict=true,legacy=false;const writes=[];
  const source={patient_id:10,appointment_id:7,client_key:'synthetic-recovery-key',note:'Текст із телефона',duration_minutes:60};
  const issues=[{id:1,user_id:3,device_id:'recovery-phone',patient_id:10,appointment_id:7,patient:'Коваль Олена',patient_no:'12345',psychologist:'Марченко Оксана',kind:'consultation',state:'open',revision:1,draft_version:1,client_key:source.client_key,payload:source,error:'Чернетку змінено',server_draft:{...source,appointment_id:'7',duration_minutes:'60',note:'Інший текст на сервері'},existing:[],appointment:{start:'2026-10-15T09:00',status:'scheduled',visit_status:''}},
  {id:2,user_id:3,device_id:'recovery-phone',patient_id:10,appointment_id:8,patient:'Бондар Андрій',patient_no:'23456',psychologist:'Марченко Оксана',kind:'consultation',state:'open',revision:1,draft_version:0,client_key:'synthetic-second-key',payload:{...source,appointment_id:8,client_key:'synthetic-second-key'},error:'Відповідь втрачено',server_draft:null,existing:[{id:88,psychologist_id:3,psychologist:'Марченко Оксана',note:'Вже проведена консультація'}],appointment:{start:'2026-10-15T10:00',status:'completed',visit_status:''}}];
  await page.route('**/api/**',async route=>{const request=route.request(),url=new URL(request.url()),path=url.pathname;let data=[];
    if(path==='/api/me')data={id:role==='admin'?1:role==='director'?4:2,name:role==='director'?'Дорошенко Олена':role==='reception'?'Сидоренко Наталія':'Коваль Андрій',role};
    else if(path==='/api/health')data={ok:true,version:'2.5.0'};
    else if(path==='/api/shift-day')data={open:true,shift_date:'2026-10-15',opened_by_name:'Коваль Андрій'};
    else if(path==='/api/reception-access')data={access_date:'2026-10-15',starts_at:'2026-10-15T08:00',allowed:true,enabled:true};
    else if(path==='/api/stats')data=stats;
    else if(path==='/api/meta')data=meta;
    else if(path==='/api/users'){data=users;if(request.method()!=='GET')edits.push(request.postDataJSON());}
    else if(path==='/api/rooms')data=rooms;
    else if(path==='/api/rooms/2'&&request.method()==='PATCH'){await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'Не вдалося зберегти демонстраційне приміщення'})});return;}
    else if(path==='/api/patients')data=url.searchParams.get('status')==='archived'?[{...p,status:'archived'}]:[p,p2];
    else if(path==='/api/patients/10')data={...p,courses:[],consultations:[],documents:[],referrals:[],discharges:[]};
    else if(path==='/api/families')data=[{id:1,name:'Родина Коваль'}];
    else if(path==='/api/settings/center')data={center_name:'Центр психологічного супроводу',connection_mode:'local'};
    else if(path==='/api/settings/workflow')data={...meta.workflow,slot_step_minutes:30,session_hours:8};
    else if(path==='/api/admin/system')data={database:{name:'solvia',size:'24 MB'},counts:{patients:86,consultations:124},backups:[{id:1,status:'success',action:'verify',created:'2026-10-15T07:00'}]};
    else if(path==='/api/mobile-update')data={available:false};
    else if(path==='/api/staff/recipients')data=[{...users[1],devices:[{device_id:'demo',device_name:'Телефон психолога',online:true}]}];
    else if(path==='/api/workload')data={week_start:'2026-10-12',items:[{id:3,name:'Марченко Оксана',active_patients:12,consultations_today:5,consultations_week:18,free_hours_today:2,cancellations_week:1,avg_duration_minutes:52}]};
    else if(path==='/api/supervisions')data=[{id:1,psychologist_id:3,psychologist:'Марченко Оксана',scheduled_at:'2026-10-16T11:00',duration_minutes:60,status:'planned',topic:'Планова супервізія',recommendations:''}];
    else if(path==='/api/shift-workspace')data=[{appointment_id:7,patient_id:10,patient:p.name,patient_no:p.patient_no,phone:p.phone,category:p.category,psychologist_id:3,psychologist:p.psychologist,room:'Кабінет 101',kind:'individual',status:'scheduled',start:'2026-10-15T09:00',end:'2026-10-15T10:00'}];
    else if(path==='/api/appointments')data=[{id:7,psychologist_id:3,psychologist:p.psychologist,room_id:2,room:'Кабінет 101',kind:'individual',status:'scheduled',start:'2026-10-15T09:00',end:'2026-10-15T10:00',patients:[p]}];
    else if(path==='/api/discharges')data=[{id:1,patient_name:p.name,document_no:'2026-12345',date_from:'2026-10-01',date_to:'2026-10-15',summary:'Демонстраційний підсумок супроводу',dynamics:'Демонстраційна динаміка',recommendations:'Демонстраційні рекомендації',followup:'Демонстраційний план',author:p.psychologist,revision:1}];
    else if(path==='/api/slots')data=['09:00','11:00','14:30'];
    else if(path==='/api/audit')data=[{id:1,created:'2026-10-15T08:00',actor:'Коваль Андрій',event:'open',entity:'shift',entity_id:1}];
    if(path==='/api/admin/devices')data=[{user_id:3,device_id:'recovery-phone',device_name:'Телефон психолога',name:'Марченко Оксана',version_name:'3.3.4',version_code:41,pending_count:0,blocked_count:1,fresh:true,last_seen:'2026-10-16T12:00:00'}];
    else if(path==='/api/admin/sessions')data=[];
    else if(path==='/api/admin/recovery')data=legacy?[]:issues.map(({payload,...row})=>row);
    else if(path.match(/^\/api\/admin\/recovery\/[12]$/)){
      const item=issues.find(i=>i.id===Number(path.split('/').at(-1)));
      if(request.method()==='POST'){
        const body=request.postDataJSON();writes.push(body);
        if(item.id===1&&conflict){await new Promise(r=>setTimeout(r,250));conflict=false;item.revision=2;item.payload={...item.payload,note:'Новіший текст із телефона'};await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'Телефон передав новішу версію. Оновіть запис.'})});return;}
        assert.equal(body.revision,item.revision);assert.equal(body.confirmed,true);assert(body.reason.trim());
        item.state=body.action==='link'?'linked':'completed';item.consultation_id=body.action==='link'?88:77;item.resolution_reason=body.reason;data={consultation_id:item.consultation_id};
      } else data=item;
    }
    await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('button',{name:'Інші функції центру',exact:true}).click();
  await page.getByRole('button',{name:'Відкрити розділ Пристрої',exact:true}).click();
  await page.getByRole('button',{name:'Проблемні записи · 1',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Проблемні записи телефона'});
  await dialog.getByRole('button').filter({hasText:'Коваль Олена'}).click();
  const conduct=dialog.getByRole('button',{name:'Провести консультацію',exact:true});assert(await conduct.isDisabled());
  await dialog.getByLabel('Підсумок консультації',{exact:true}).fill('Перевірений текст адміністратора');
  await dialog.getByLabel('Причина обробки',{exact:true}).fill('Звірено з психологом');
  await dialog.getByRole('checkbox').nth(0).check();await dialog.getByRole('checkbox').nth(1).check();
  await conduct.dblclick();assert(await dialog.getByLabel('Підсумок консультації',{exact:true}).isDisabled(),'Protect text while saving');await dialog.getByRole('alert').filter({hasText:'Телефон передав новішу версію'}).waitFor();
  assert.equal(writes.length,1);assert.equal(await dialog.getByLabel('Підсумок консультації',{exact:true}).inputValue(),'Перевірений текст адміністратора');
  page.once('dialog',d=>d.accept());await dialog.getByRole('button',{name:'Завантажити актуальну версію',exact:true}).click();
  assert.equal(await dialog.getByLabel('Підсумок консультації',{exact:true}).inputValue(),'Новіший текст із телефона');
  await dialog.getByLabel('Підсумок консультації',{exact:true}).fill('Перевірено після оновлення');
  await dialog.getByLabel('Причина обробки',{exact:true}).fill('Звірено актуальну версію');
  await dialog.getByRole('checkbox').nth(0).check();await dialog.getByRole('checkbox').nth(1).check();
  await conduct.click();await dialog.getByText('Запис оброблений · консультація № 77.',{exact:false}).waitFor();
  assert.equal(writes.length,2);assert.equal(writes[1].payload.note,'Перевірено після оновлення');assert.equal(writes[1].confirm_server_conflict,true);
  await dialog.getByRole('button').filter({hasText:'Бондар Андрій'}).click();
  await dialog.getByText('У базі вже є консультація цього прийому',{exact:true}).waitFor();assert.equal(await conduct.count(),0);
  await dialog.getByLabel('Причина обробки',{exact:true}).fill('Запис уже є в базі');await dialog.getByRole('checkbox').check();
  await dialog.getByRole('button',{name:'Підтвердити проведену № 88',exact:true}).click();
  await dialog.getByText('Запис оброблений · консультація № 88.',{exact:false}).waitFor();assert.equal(writes.at(-1).action,'link');
  await page.setViewportSize({width:1024,height:600});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  await mkdir('out/design',{recursive:true});await page.screenshot({path:'out/design/desktop-recovery.png',fullPage:true});
  await dialog.getByRole('button',{name:'Закрити',exact:true}).click();legacy=true;
  await page.getByRole('button',{name:'Проблемні записи · 1',exact:true}).click();
  await dialog.getByRole('heading',{name:'Текст проблемних записів ще не переданий',exact:true}).waitFor();
  assert.equal(await dialog.getByRole('button',{name:'Провести консультацію',exact:true}).count(),0);
  assert.deepEqual(errors,[]);console.log('PASS: recovery completion, preserved edits on conflict, explicit reload, no double submit, linking without duplicates, legacy phone explanation and compact layout');
}finally{await browser.close();await new Promise(r=>server.close(r));}
