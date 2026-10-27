// Role boundaries and the actual desktop bundle, with synthetic center data.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {createRequire} from 'node:module';

const require=createRequire(import.meta.url),{chromium}=require(process.env.SOLVIA_PLAYWRIGHT_MODULE||'playwright');
const root=resolve('frontend/dist'),server=createServer(async(req,res)=>{try{const path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(path!==root&&!path.startsWith(root+'/')){res.writeHead(403).end();return;}const file=path===root?resolve(root,'index.html'):path;res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,...(process.env.SOLVIA_CHROMIUM_EXECUTABLE?{executablePath:process.env.SOLVIA_CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage']}:{})});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});await page.emulateMedia({reducedMotion:'reduce'});
  let workflowRows=[],workflowCursor=0,workflowReads=0;let role='admin';const errors=[],edits=[];page.on('pageerror',e=>errors.push(e.message));
  const p={id:10,patient_no:'12345',name:'Коваль Олена',phone:'+380671234567',dob:'1990-01-01',category:'Ветеран/ветеранка',psychologist_id:3,psychologist:'Марченко Оксана',status:'active',family_id:1,family:'Родина Коваль'};
  const p2={...p,id:11,name:'Бондар Андрій',patient_no:'23456',phone:'+380681234567',category:'Військовий/військова',family_id:null,family:''};
  const users=[{id:1,name:'Коваль Андрій',role:'admin',login:'admin',phone:'+380501234567',active:true,active_sessions:1,platforms:'Desktop'},{id:3,name:'Марченко Оксана',role:'psychologist',login:'oksana',phone:'+380501234568',active:true,active_sessions:1,platforms:'Android'}];
  const rooms=[{id:2,name:'Кабінет 101',code:'101',capacity:2,type:'individual',active:true,description:'Індивідуальні консультації'},{id:4,name:'Зала групової роботи',code:'201',capacity:12,type:'group',active:false,description:'Групові заняття'}];
  const stats={total_patients:86,active_patients:32,archived_patients:54,new_patients:8,consultations:124,avg_duration_minutes:52,active_courses:28,completed_courses:12,signed_documents:64,outgoing_referrals:9,supervisions_completed:6,appointments:{no_show:3},categories:[{category:'Ветеран/ветеранка',n:38},{category:'Військовий/військова',n:32},{category:'Партнер/партнерка',n:16}],referral_sources:[{source:'Військова частина',n:34},{source:'Самозвернення',n:28}],load:[{name:'Марченко Оксана',appointments:18,hours:16},{name:'Литвин Максим',appointments:14,hours:12},{name:'Кравчук Ірина',appointments:10,hours:8}]};
  const meta={psychologists:[...users.filter(u=>u.role==='psychologist'),{id:4,name:'Литвин Максим'},{id:5,name:'Кравчук Ірина'}],rooms:rooms.filter(r=>r.active),categories:['Військовий/військова','Ветеран/ветеранка'],workflow:{opening_time:'08:00',closing_time:'20:00',working_days:'1234567',default_duration_minutes:60}};
  await page.addInitScript(()=>sessionStorage.setItem('solvia_token','synthetic-design'));
  await page.route('**/api/**',async route=>{const request=route.request(),url=new URL(request.url()),path=url.pathname;let data=[];
    if(path==='/api/me')data={id:role==='admin'?1:role==='director'?4:2,name:role==='director'?'Дорошенко Олена':role==='reception'?'Сидоренко Наталія':'Коваль Андрій',role};
    else if(path==='/api/workflow-events'){workflowReads++;const after=url.searchParams.get('after');data={events:after===null?workflowRows:workflowRows.filter(e=>e.id>Number(after)),cursor:workflowCursor,initial:after===null};}
    else if(path==='/api/health')data={ok:true,version:'2.5.0'};
    else if(path==='/api/shift-day')data={open:true,shift_date:'2026-10-15',opened_by_name:'Коваль Андрій'};
    else if(path==='/api/reception-access')data={access_date:'2026-10-15',starts_at:'2026-10-15T08:00',allowed:true,enabled:true};
    else if(path==='/api/stats')data=stats;
    else if(path==='/api/meta')data=meta;
    else if(path==='/api/users'){data=users;if(request.method()!=='GET')edits.push(request.postDataJSON());}
    else if(path==='/api/rooms')data=rooms;
    else if(path==='/api/rooms/2'&&request.method()==='PATCH'){await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'Не вдалося зберегти демонстраційне приміщення'})});return;}
    else if(path==='/api/patient-directory'){
      const q=(url.searchParams.get('q')||'').toLowerCase();const items=[p,p2].filter(item=>[item.name,item.phone,item.patient_no,item.category,item.psychologist,item.family].some(v=>String(v||'').toLowerCase().includes(q)));data={items,total:items.length,page:1,page_size:25};
    }
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
    else if(path==='/api/appointments')data=[{id:7,psychologist_id:3,psychologist:p.psychologist,room_id:2,room:'Кабінет 101',kind:'individual',status:'scheduled',start:'2026-10-15T09:00',end:'2026-10-15T10:00',patients:[p]},{id:8,psychologist_id:4,psychologist:'Литвин Максим',room_id:2,room:'Кабінет 102',kind:'individual',status:'confirmed',start:'2026-10-15T10:30',end:'2026-10-15T11:15',patients:[p2]},{id:9,psychologist_id:5,psychologist:'Кравчук Ірина',room_id:2,room:'Кабінет 103',kind:'group',status:'scheduled',start:'2026-10-15T09:30',end:'2026-10-15T11:00',patients:[p,p2]}];
    else if(path==='/api/discharges')data=[{id:1,patient_name:p.name,document_no:'2026-12345',date_from:'2026-10-01',date_to:'2026-10-15',summary:'Демонстраційний підсумок супроводу',dynamics:'Демонстраційна динаміка',recommendations:'Демонстраційні рекомендації',followup:'Демонстраційний план',author:p.psychologist,revision:1}];
    else if(path==='/api/slots')data=['09:00','11:00','14:30'];
    else if(path==='/api/audit')data=[{id:1,created:'2026-10-15T08:00',actor:'Коваль Андрій',event:'open',entity:'shift',entity_id:1}];
    await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  });
  await mkdir('out/design',{recursive:true});
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('button',{name:'Події та повідомлення',exact:true}).click();
  await page.getByText('Події оновлюються автоматично',{exact:true}).waitFor();
  assert.equal(await page.locator('.workflow-toast').count(),0,'Initial baseline is silent');
  await page.getByRole('button',{name:'Увімкнути звук',exact:true}).click();
  await page.getByRole('button',{name:'Вимкнути звук',exact:true}).waitFor();
  workflowCursor=1;workflowRows=[{id:1,kind:'patient.arrived',actor_id:2,actor:'Тестова рецепція',start:'2026-10-15T09:00',room:'Кабінет 101',created:'2026-10-15T08:58'}];
  await page.locator('.workflow-toast').getByText('Пацієнт прибув',{exact:true}).waitFor();
  assert.equal(await page.locator('.workflow-event').count(),1);
  const firstReads=workflowReads;await page.waitForTimeout(5500);
  assert(workflowReads>firstReads,'Automatic polling continues');
  assert.equal(await page.locator('.workflow-event').count(),1,'Event history is deduplicated');
  for(const viewport of [{width:360,height:640},{width:768,height:1024},{width:1440,height:900}]){
    await page.setViewportSize(viewport);const box=await page.locator('.workflow-drawer').boundingBox();
    assert(box.x>=0&&box.x+box.width<=viewport.width&&box.y+box.height<=viewport.height,'Event drawer fits every viewport');
  }
  await page.screenshot({path:'out/design/workflow-events.png'});
  await page.getByRole('button',{name:'Закрити події',exact:true}).click();
  workflowCursor=2;workflowRows.push({id:2,kind:'appointment.created',actor_id:1,actor:'Тестовий адміністратор',start:'2026-10-15T09:30',room:'Кабінет 101'});
  await page.waitForTimeout(5500);assert.equal(await page.locator('.workflow-bell>span').count(),0,'Own actions do not create duplicate unread alerts');
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('solvia:feedback',{detail:{title:'Запис створено'}})));
  await page.locator('.workflow-toast').getByText('Запис створено',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Події та повідомлення',exact:true}).click();
  assert.equal(await page.locator('.workflow-event').count(),2,'Own events remain visible in history');
  await page.locator('.workflow-event').filter({hasText:'Пацієнт прибув'}).click();
  await page.getByRole('heading',{name:'Календар центру',exact:true}).waitFor();
  assert.deepEqual(errors,[]);
  console.log('PASS: live role events, silent baseline, sound opt-in, deduplication, responsive drawer, local success and event navigation');
}finally{await browser.close();await new Promise(r=>server.close(r));}
