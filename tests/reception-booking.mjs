// Exercise the shipped React bundle: reception booking, conflicts, group transfer and registration.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.SOLVIA_PLAYWRIGHT_MODULE || 'playwright');
const root=resolve('frontend/dist');
const server=createServer(async(req,res)=>{try{const path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname);if(path!==root&&!path.startsWith(root+'/')){res.writeHead(403).end();return;}const file=path===root?resolve(root,'index.html'):path;res.setHeader('Content-Type',({'.js':'application/javascript','.css':'text/css','.html':'text/html','.png':'image/png'})[extname(file)]||'application/octet-stream');res.end(await readFile(file));}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,...(process.env.SOLVIA_CHROMIUM_EXECUTABLE?{executablePath:process.env.SOLVIA_CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage']}:{})});
try{
  const page=await browser.newPage({viewport:{width:1280,height:720},locale:'uk-UA'});
  await page.emulateMedia({reducedMotion:'reduce'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const patients=[{id:10,name:'Олена Демонстраційна',patient_no:'12345',phone:'+380671234567',psychologist_id:3,psychologist:'Психолог Оксана',category:'Інше',status:'active'}, {id:11,name:'Петро Демонстраційний',patient_no:'23456',phone:'+380681234567',psychologist_id:3,psychologist:'Психолог Оксана',category:'Інше',status:'active'}, {id:12,name:'Інший психолог',patient_no:'34567',phone:'+380691234567',psychologist_id:4,status:'active'}];
  const visit={appointment_id:7,patient_id:10,patient:patients[0].name,patient_no:'12345',psychologist_id:3,psychologist:'Психолог Оксана',room:'Кабінет 1',status:'scheduled',kind:'group',start:'2026-10-15T09:00',end:'2026-10-15T10:00'};
  const appointment={...visit,id:7,room_id:2,patients:patients.slice(0,2)};
  let posts=[],patches=[],slotDurations=[],firstConflict=true,holdSave=false,releaseSave;
  await page.addInitScript(()=>sessionStorage.setItem('solvia_token','synthetic-reception'));
  await page.route('**/api/**',async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method();let data=[];
    if(path==='/api/me')data={id:2,name:'Реєстратура · демонстрація',role:'reception'};
    else if(path==='/api/health')data={ok:true,version:'2.5.0'};
    else if(path==='/api/shift-day')data={open:true,shift_date:'2026-10-14'};
    else if(path==='/api/workday/home')data={date:'2026-10-15',counts:{waiting:1,arrived:0,completed:0},active_patients:3,waiting_list:0,next:[]};
    else if(path==='/api/reception-access')data={access_date:'2026-10-15',starts_at:'2026-10-15T08:00',enabled:true,allowed:true};
    else if(path==='/api/meta')data={rooms:[{id:2,name:'Кабінет 1'}],psychologists:[{id:4,name:'Психолог Максим'},{id:3,name:'Психолог Оксана'}],categories:['Інше'],workflow:{opening_time:'08:00',closing_time:'20:00',default_duration_minutes:60,working_days:'1234567'}};
    else if(path==='/api/patients'&&method==='GET')data=patients;
    else if(path==='/api/patients'&&method==='POST'){const p={...req.postDataJSON(),id:13,patient_no:'45678',psychologist:'Психолог Оксана',status:'active'};patients.push(p);data={id:13};}
    else if(path==='/api/families')data=[];
    else if(path==='/api/shift-workspace')data=[visit];
    else if(path==='/api/appointments'&&method==='GET')data=[appointment];
    else if(path==='/api/slots'){slotDurations.push(url.searchParams.get('duration_minutes'));data=['10:00','14:30','16:00'];}
    else if(path==='/api/appointments'&&method==='POST'){
      posts.push(req.postDataJSON());
      if(firstConflict){firstConflict=false;await route.fulfill({status:409,contentType:'application/json',body:JSON.stringify({error:'Психолог або кабінет уже зайняті'})});return;}
      if(holdSave)await new Promise(r=>{releaseSave=r;});data={id:20};
    }
    else if(path==='/api/appointments/7'&&method==='PATCH'){patches.push(req.postDataJSON());data={id:7};}
    await route.fulfill({contentType:'application/json',body:JSON.stringify(data)});
  });
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('heading',{name:'Реєстратура',exact:true}).waitFor();
  await page.locator('.focus-navigation').getByRole('button',{name:'Прийоми',exact:true}).click();
  await page.getByRole('heading',{name:'Прийоми за зміну',exact:true}).waitFor();
  await page.getByRole('button',{name:'+ Записати на прийом',exact:true}).click();
  let dialog=page.getByRole('dialog',{name:'Запис на консультацію',exact:true});
  await dialog.getByLabel('Знайти пацієнта',{exact:true}).fill('380 67');
  await dialog.getByRole('group',{name:'Знайдені пацієнти'}).getByRole('button',{name:/Олена Демонстраційна/}).click();
  assert.equal(await dialog.getByLabel('Психолог',{exact:true}).inputValue(),'3','Use assigned psychologist, not first metadata item');
  await dialog.getByLabel('Дата консультації',{exact:true}).fill('2026-10-20');
  await dialog.getByRole('button',{name:'45 хв',exact:true}).click();
  await dialog.getByRole('button',{name:'14:30',exact:true}).click();
  await dialog.getByLabel('Час початку',{exact:true}).fill('14:35');
  await page.waitForFunction(()=>document.querySelector('.booking-footer')?.textContent.includes('15:20'));
  await mkdir('out/design',{recursive:true});
  await page.setViewportSize({width:1440,height:1000});
  await dialog.locator('.dialog-body').evaluate(el=>el.scrollTo(0,0));
  await page.screenshot({path:'out/design/reception-booking.png',fullPage:true});
  await page.setViewportSize({width:1280,height:720});
  await dialog.getByRole('button',{name:'Записати пацієнта',exact:true}).click();
  await dialog.getByRole('alert').getByText('Психолог або кабінет уже зайняті',{exact:true}).waitFor();
  assert.equal(await dialog.getByLabel('Час початку',{exact:true}).inputValue(),'14:35','Conflict must preserve inputs');
  holdSave=true;
  await dialog.locator('form').evaluate(form=>{form.requestSubmit();form.requestSubmit();});
  await dialog.getByRole('button',{name:'Зберігаємо…',exact:true}).waitFor();
  assert.equal(posts.length,2,'Only one retry despite repeated submit');
  releaseSave();holdSave=false;
  await dialog.waitFor({state:'hidden'});
  await page.locator('.booking-success').getByText(/14:35/).waitFor();
  assert.equal(posts[1].psychologist_id,3);assert.equal(posts[1].end,'2026-10-20T15:20');
  assert(slotDurations.includes('45'));
  assert.equal(await page.getByRole('heading',{name:'Календар центру',exact:true}).count(),0,'Booking must not navigate to calendar');
  // Transfer the exact selected group appointment, retaining every participant.
  await page.locator('.shift-visit').first().click();
  await page.getByRole('button',{name:'Перенести прийом',exact:true}).click();
  dialog=page.getByRole('dialog',{name:'Перенести / змінити прийом',exact:true});
  await dialog.getByLabel('Час початку',{exact:true}).waitFor();
  assert.equal(await dialog.getByLabel('Час початку',{exact:true}).inputValue(),'09:00');
  await dialog.getByLabel('Дата консультації',{exact:true}).fill('2026-10-16');
  await dialog.getByLabel('Час початку',{exact:true}).fill('11:17');
  await dialog.getByRole('button',{name:'Зберегти перенесення',exact:true}).click();
  await dialog.waitFor({state:'hidden'});
  assert.deepEqual(patches[0].patient_ids,[10,11]);assert.equal(patches[0].start,'2026-10-16T11:17');
  // Family selection uses ordinary buttons, not a Ctrl+click multiselect.
  await page.getByRole('button',{name:'+ Записати на прийом',exact:true}).click();
  dialog=page.getByRole('dialog',{name:'Запис на консультацію',exact:true});
  await dialog.getByLabel('Тип консультації',{exact:true}).selectOption('family');
  const results=dialog.getByRole('group',{name:'Знайдені пацієнти'});
  await results.getByRole('button',{name:/Олена Демонстраційна/}).click();
  await results.getByRole('button',{name:/Петро Демонстраційний/}).click();
  assert.equal(await results.getByRole('button',{name:/Інший психолог/}).isDisabled(),true);
  await page.setViewportSize({width:1024,height:600});
  const footer=await dialog.getByRole('button',{name:'Записати учасників',exact:true}).boundingBox();
  assert(footer&&footer.y>=0&&footer.y+footer.height<=600,'Save stays visible on short desktop');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
  await dialog.getByRole('button',{name:'Записати учасників',exact:true}).click();
  await dialog.waitFor({state:'hidden'});
  assert.deepEqual(posts.at(-1).patient_ids,[10,11]);assert.equal(posts.at(-1).kind,'family');
  // Registration can lead straight into booking, preserving the new patient's identity.
  await page.getByRole('button',{name:'+ Новий пацієнт',exact:true}).click();
  const registration=page.getByRole('dialog',{name:'Новий пацієнт',exact:true});
  await registration.getByLabel('ПІБ',{exact:true}).fill('Новий демонстраційний пацієнт');
  await registration.getByLabel('Телефон',{exact:true}).fill('+380501234567');
  await registration.getByLabel('Дата народження',{exact:true}).fill('1990-01-01');
  await registration.getByLabel('Психолог',{exact:true}).selectOption('3');
  await registration.getByRole('button',{name:'Зареєструвати й записати',exact:true}).click();
  dialog=page.getByRole('dialog',{name:'Запис на консультацію',exact:true});
  await dialog.locator('.booking-selected').getByText('Новий демонстраційний пацієнт',{exact:true}).waitFor();
  assert.equal(await dialog.getByLabel('Психолог',{exact:true}).inputValue(),'3');
  await page.setViewportSize({width:1280,height:720});
  await page.screenshot({path:'out/design/reception-new-patient-booking.png',fullPage:true});
  await dialog.getByRole('button',{name:'Скасувати',exact:true}).click();
  await dialog.waitFor({state:'hidden'});
  await page.locator('.focus-navigation').getByRole('button',{name:'Прийоми',exact:true}).click();
  await page.getByRole('heading',{name:'Прийоми за зміну',exact:true}).waitFor();
  await page.setViewportSize({width:1440,height:1000});
  await page.screenshot({path:'out/design/reception-workspace.png',fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('PASS: direct booking, assigned psychologist, minute precision, conflict recovery, double-submit lock, exact group transfer, family selection, registration-to-booking and short-screen controls');
}finally{await browser.close();await new Promise(r=>server.close(r));}
