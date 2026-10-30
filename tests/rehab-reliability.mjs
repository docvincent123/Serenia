// Exercise calendar actions after a network failure and out-of-order day loads.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{chromium}=require(process.env.SOLVIA_PLAYWRIGHT_MODULE||'playwright');
const root=resolve('frontend/dist');
const server=createServer(async(req,res)=>{
 try{
  const path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
  if(path!==root&&!path.startsWith(root+'/')){res.writeHead(403).end();return;}
  const file=path===root?resolve(root,'index.html'):path;
  res.setHeader('Content-Type',({'.js':'application/javascript','.css':'text/css','.html':'text/html','.png':'image/png'})[extname(file)]||'application/octet-stream');
  res.end(await readFile(file));
 }catch{res.writeHead(404).end();}
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,...(process.env.SOLVIA_CHROMIUM_EXECUTABLE?{executablePath:process.env.SOLVIA_CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage']}:{})});
try{
 const page=await browser.newPage({viewport:{width:1366,height:900}});await page.emulateMedia({reducedMotion:'reduce'});
 const errors=[],creates=[],updates=[];let goal=null,firstCreate=true,firstConflict=true,loseUpdate=true,lastUpdateKey='',failLoad=false;
 page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>sessionStorage.setItem('solvia_token','synthetic-rehabilitation'));
 const person={id:10,name:'Тестова Людина',patient_no:'50001',phone:'+380501234567',dob:'1990-01-01',category:'Інше',status:'active',psychologist_id:3,psychologist:'Психолог',courses:[{id:1,course_no:1,status:'active',started_at:'2026-10-01'}],consultations:[],documents:[],referrals:[],discharges:[]};
 await page.route('**/api/**',async route=>{
  const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method();let data=[];
  const reply=(status,body)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
  if(path==='/api/me')data={id:3,name:'Психолог',role:'psychologist'};
  else if(path==='/api/health')data={ok:true,version:'3.1.1'};
  else if(path==='/api/shift-day')data={open:true,shift_date:'2026-11-01'};
  else if(path==='/api/reception-access')data={allowed:true};
  else if(path==='/api/client-status')data={mode:'ready'};
  else if(path==='/api/meta')data={rooms:[],psychologists:[{id:3,name:'Психолог'}],categories:['Інше'],workflow:{}};
  else if(path==='/api/patient-directory')data={items:[person],total:1,page:1,page_size:25};
  else if(path==='/api/patients/10')data=person;
  else if(path==='/api/patients/10/rehab-goals'&&method==='GET'){
   if(failLoad)return reply(503,{error:'Тестова втрата зв’язку з планом'});data=goal?[goal]:[];
  }
  else if(path==='/api/patients/10/rehab-goals'&&method==='POST'){
   const body=req.postDataJSON();creates.push(body);
   if(firstCreate){firstCreate=false;goal={id:8,patient_id:10,course_id:1,course_no:1,course_status:'active',owner_name:'Психолог',revision:1,title:body.title,state:'planned',updates:[{id:1,note:'Ціль створено'}]};await route.abort();return;}
   assert.equal(body.client_key,creates[0].client_key,'Lost create response reuses receipt');data={id:8,revision:1,already_saved:true};
  }
  else if(path==='/api/rehab-goals/8'&&method==='GET')data=goal;
  else if(path==='/api/rehab-goals/8'&&method==='PATCH'){
   const body=req.postDataJSON();updates.push(body);
   if(firstConflict){firstConflict=false;goal={...goal,revision:2,state:'paused',updates:[{id:2,note:'Зміна іншого пристрою'},...goal.updates]};return reply(409,{error:'Ціль змінено на іншому пристрої'});}
   if(loseUpdate){loseUpdate=false;lastUpdateKey=body.client_key;goal={...goal,revision:3,state:body.state,progress_value:body.progress_value,updates:[{id:3,note:body.note},...goal.updates]};await route.abort();return;}
   assert.equal(body.client_key,lastUpdateKey,'Lost progress response reuses receipt');data={ok:true,revision:3,already_saved:true};
  }
  await reply(200,data);
 });
 await page.goto(`http://127.0.0.1:${server.address().port}`);
 await page.locator('.focus-nav-primary').getByRole('button',{name:'Пацієнти',exact:true}).click();
 await page.locator('.patient-list-card').click();
 await page.getByRole('navigation',{name:'Розділи картки'}).getByRole('button',{name:'Супровід',exact:true}).click();
 const plan=page.locator('.rehab-plan');await plan.getByRole('button',{name:'+ Ціль',exact:true}).click();
 await plan.getByLabel('Ціль',{exact:true}).fill('Відновити повсякденну активність');
 await plan.locator('form').evaluate(f=>{f.requestSubmit();f.requestSubmit();});
 await plan.getByRole('alert').waitFor();assert.equal(creates.length,1,'Duplicate create submit is locked');
 assert.equal(await plan.getByLabel('Ціль',{exact:true}).inputValue(),'Відновити повсякденну активність');
 await plan.getByRole('button',{name:'Зберегти ціль',exact:true}).click();
 await plan.getByRole('heading',{name:'Відновити повсякденну активність',exact:true}).waitFor();
 assert.equal(creates.length,2);assert.equal(await plan.locator('.rehab-goal').count(),1);
 await plan.getByRole('button',{name:'Зафіксувати прогрес',exact:true}).click();
 await plan.getByLabel('Поточний результат',{exact:true}).fill('Самостійно виконує вправу');
 await plan.getByLabel('Пояснення зміни',{exact:true}).fill('Текст психолога не повинен зникнути');
 await plan.getByRole('button',{name:'Зберегти',exact:true}).click();
 await plan.getByRole('button',{name:'Оновити дані цілі',exact:true}).click();
 await plan.getByRole('status').filter({hasText:'Ваш текст збережено'}).waitFor();
 assert.equal(await plan.getByLabel('Пояснення зміни',{exact:true}).inputValue(),'Текст психолога не повинен зникнути');
 await plan.getByRole('button',{name:'Зберегти',exact:true}).click();await plan.getByRole('alert').waitFor();
 await plan.getByRole('button',{name:'Зберегти',exact:true}).click();
 await plan.getByRole('status').filter({hasText:'Прогрес збережено'}).waitFor();
 assert.deepEqual(updates.map(x=>x.revision),[1,2,2]);assert.equal(goal.updates.length,3);
 failLoad=true;await plan.getByRole('button',{name:'Оновити',exact:true}).click();
 await plan.getByRole('alert').filter({hasText:'Тестова втрата зв’язку'}).waitFor();assert.equal(await plan.locator('.rehab-goal').count(),0,'Failed refresh hides old goal actions');
 failLoad=false;await plan.getByRole('button',{name:'Оновити',exact:true}).click();await plan.locator('.rehab-goal').waitFor();
 await mkdir('out/design',{recursive:true});await page.screenshot({path:'out/design/lemvorilab-rehab-plan.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(250);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
 assert.deepEqual(errors,[]);console.log('PASS: rehabilitation duplicate-submit lock, lost-response retries, conflict recovery with preserved text and stale-action removal');
}finally{await browser.close();await new Promise(r=>server.close(r));}
