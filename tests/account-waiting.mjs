// Exercise the shipped account screens, messaging boundary and complete waiting-list booking.
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
  const page=await browser.newPage({viewport:{width:1440,height:1000},locale:'uk-UA'});await page.emulateMedia({reducedMotion:'reduce'});
  const errors=[],passwordPosts=[],bookings=[],creations=[];let role='reception',authenticated=false,conflict=true;
  page.on('pageerror',e=>errors.push(e.message));
  const patient={id:10,name:'Олена Демонстраційна',patient_no:'12345',phone:'+380671234567',psychologist_id:3,psychologist:'Психолог Оксана',status:'active'};
  let waiting=[{id:5,patient_id:10,patient:patient.name,patient_no:patient.patient_no,phone:patient.phone,psychologist_id:3,psychologist:patient.psychologist,date_from:'2026-10-20',date_to:'2026-10-23',time_from:'09:00',time_to:'17:00',priority:'high',status:'waiting',version:1,contact_note:'Телефонувати після 15:00'}];
  await page.route('**/api/**',async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname,method=req.method();let data=[];
    const fulfill=(status,body)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
    if(path==='/api/login'){if(req.postDataJSON().password==='wrong')return fulfill(401,{error:'Неправильний логін або пароль'});authenticated=true;data={token:'synthetic-account',user:{id:2,name:'Наталія Демонстраційна',role,login:'reception'}};}
    else if(path==='/api/me'){if(!authenticated)return fulfill(401,{error:'Необхідний вхід'});data={id:2,name:'Наталія Демонстраційна',role,login:'reception'};}
    else if(path==='/api/health')data={ok:true,version:'2.5.0',platform:'Linux'};
    else if(path==='/api/shift-day')data={open:true,shift_date:'2026-10-16'};
    else if(path==='/api/reception-access')data={allowed:true,enabled:true,access_date:'2026-10-16',starts_at:'2026-10-16T08:00'};
    else if(path==='/api/meta')data={rooms:[{id:2,name:'Кабінет 101',active:true},{id:4,name:'Закритий кабінет',active:false}],psychologists:[{id:3,name:'Психолог Оксана'}],workflow:{default_duration_minutes:60}};
    else if(path==='/api/patients')data=[patient];
    else if(path==='/api/waiting-list'&&method==='GET')data=waiting;
    else if(path==='/api/waiting-list'&&method==='POST'){creations.push(req.postDataJSON());data={id:6};}
    else if(path==='/api/slots')data=['08:00','10:00','16:30','18:00'];
    else if(path==='/api/waiting-list/5/book'){
      bookings.push(req.postDataJSON());if(conflict){conflict=false;return fulfill(409,{error:'Кабінет уже зайнятий. Оберіть інший час.'});}
      waiting=[{...waiting[0],status:'booked',version:2,appointment_id:30}];data={id:30};
    }
    else if(path==='/api/account/password'){passwordPosts.push(req.postDataJSON());if(passwordPosts.length===1)return fulfill(403,{error:'Поточний пароль неправильний'});data={ok:true};}
    await fulfill(200,data);
  });
  await mkdir('out/design',{recursive:true});const url=`http://127.0.0.1:${server.address().port}`;await page.goto(url);await page.getByLabel('Логін',{exact:true}).waitFor();await page.screenshot({path:'out/design/refined-login.png',fullPage:true});
  await page.getByLabel('Логін',{exact:true}).fill('reception');await page.getByLabel('Пароль',{exact:true}).fill('wrong');
  await page.getByRole('button',{name:'Показати',exact:true}).click();assert.equal(await page.getByLabel('Пароль',{exact:true}).getAttribute('type'),'text');await page.getByRole('button',{name:'Сховати',exact:true}).click();
  await page.getByRole('button',{name:'Увійти до SOLVIA',exact:true}).click();await page.getByRole('alert').waitFor();
  await page.getByLabel('Пароль',{exact:true}).fill('synthetic');
  await page.getByRole('button',{name:'Підключення до центру',exact:true}).click();await page.getByRole('button',{name:'Перевірити та зберегти адресу',exact:true}).click();await page.getByRole('status').getByText(/Сервер SOLVIA/).waitFor();
  await page.getByRole('button',{name:'Сховати підключення',exact:true}).click();await page.getByRole('button',{name:'Увійти до SOLVIA',exact:true}).click();
  await page.getByRole('heading',{name:'Прийоми за зміну',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Написати психологу',exact:true}).count(),0);assert.equal(await page.getByRole('navigation',{name:'Робочі розділи'}).getByRole('button',{name:'Повідомлення',exact:true}).count(),0);
  await page.getByRole('button',{name:'Мій профіль',exact:true}).click();await page.getByRole('heading',{name:'Налаштування профілю',exact:true}).waitFor();
  assert.equal(await page.locator('.account-identity h2').textContent(),'Наталія Демонстраційна');await page.getByRole('checkbox',{name:/Зменшити анімації/}).check();assert.equal(await page.evaluate(()=>JSON.parse(localStorage.solvia_preferences).reducedMotion),true);
  await page.screenshot({path:'out/design/refined-profile.png',fullPage:true});await page.getByLabel('Поточний пароль',{exact:true}).fill('old');await page.getByLabel('Новий пароль',{exact:true}).fill('new');await page.getByLabel('Повторіть новий пароль',{exact:true}).fill('different');await page.getByRole('button',{name:'Змінити пароль',exact:true}).click();await page.getByRole('alert').getByText('Нові паролі не збігаються.',{exact:true}).waitFor();assert.equal(passwordPosts.length,0);
  await page.getByLabel('Повторіть новий пароль',{exact:true}).fill('new');await page.getByRole('button',{name:'Змінити пароль',exact:true}).click();await page.getByRole('alert').getByText('Поточний пароль неправильний',{exact:true}).waitFor();
  assert.equal(await page.getByLabel('Новий пароль',{exact:true}).inputValue(),'new');
  await page.setViewportSize({width:1024,height:600});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await page.screenshot({path:'out/design/refined-profile-short.png',fullPage:true});await page.setViewportSize({width:1440,height:1000});
  await page.getByRole('button',{name:'Лист очікування',exact:true}).click();await page.getByRole('button',{name:patient.name,exact:true}).waitFor();
  await page.getByLabel('Пошук у листі очікування',{exact:true}).fill('неіснуючий');await page.getByRole('heading',{name:'Нічого не знайдено'}).waitFor();await page.getByLabel('Пошук у листі очікування',{exact:true}).fill('12345');assert.equal(await page.locator('.waiting-card').count(),1);await page.screenshot({path:'out/design/refined-waiting-list.png',fullPage:true});
  await page.getByRole('button',{name:'+ Додати в очікування',exact:true}).click();let dialog=page.getByRole('dialog',{name:'Нове очікування'});await dialog.getByLabel('Знайти пацієнта',{exact:true}).fill('12345');await dialog.getByLabel('Пацієнт',{exact:true}).selectOption('10');
  await dialog.getByLabel('З дати',{exact:true}).fill('2026-10-20');await dialog.getByLabel('До дати',{exact:true}).fill('2026-10-23');await dialog.getByLabel('Не раніше',{exact:true}).fill('18:00');await dialog.getByLabel('Не пізніше',{exact:true}).fill('09:00');await dialog.getByRole('button',{name:'Додати в очікування',exact:true}).click();await dialog.getByRole('alert').getByText(/Перевірте діапазон/).waitFor();assert.equal(creations.length,0);
  await dialog.getByLabel('Не раніше',{exact:true}).fill('09:00');await dialog.getByLabel('Не пізніше',{exact:true}).fill('18:00');await page.screenshot({path:'out/design/refined-waiting-create.png',fullPage:true});await dialog.getByRole('button',{name:'Додати в очікування',exact:true}).click();await dialog.waitFor({state:'hidden'});assert.equal(creations[0].psychologist_id,3);
  await page.getByRole('button',{name:'Підібрати час',exact:true}).click();dialog=page.getByRole('dialog',{name:'Підібрати час',exact:true});const times=dialog.getByRole('group',{name:'Доступний час'});await times.getByRole('button',{name:'10:00 — 11:00',exact:true}).waitFor();assert.equal(await times.getByRole('button').count(),1,'Respect both ends of patient time preferences');assert.equal(await dialog.getByLabel('Кабінет',{exact:true}).getByRole('option',{name:'Закритий кабінет'}).count(),0);
  assert.equal(await dialog.getByRole('button',{name:'Записати пацієнта',exact:true}).isDisabled(),true);await times.getByRole('button',{name:'10:00 — 11:00',exact:true}).click();assert.equal(await dialog.getByRole('button',{name:'Записати пацієнта',exact:true}).isDisabled(),true);await dialog.getByRole('checkbox',{name:'Пацієнт погодив дату й час',exact:true}).check();await page.screenshot({path:'out/design/refined-waiting-booking.png',fullPage:true});await page.setViewportSize({width:1024,height:600});const confirmBox=await dialog.getByRole('button',{name:'Записати пацієнта',exact:true}).boundingBox();assert(confirmBox&&confirmBox.y>=0&&confirmBox.y+confirmBox.height<=600,'Confirmation remains visible in short desktop');assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);await page.screenshot({path:'out/design/refined-waiting-booking-short.png',fullPage:true});await page.setViewportSize({width:1440,height:1000});
  await dialog.getByRole('button',{name:'Записати пацієнта',exact:true}).click();await dialog.getByRole('alert').getByText(/Кабінет уже зайнятий/).waitFor();assert.equal(await dialog.getByLabel('Дата',{exact:true}).inputValue(),'2026-10-20');assert.equal(await dialog.getByRole('checkbox',{name:'Пацієнт погодив дату й час',exact:true}).isChecked(),false,'After conflict require a new slot and renewed consent');
  await times.getByRole('button',{name:'10:00 — 11:00',exact:true}).click();await dialog.getByRole('checkbox',{name:'Пацієнт погодив дату й час',exact:true}).check();await dialog.locator('form').evaluate(f=>{f.requestSubmit();f.requestSubmit();});await dialog.waitFor({state:'hidden'});assert.equal(bookings.length,2,'One save per attempt');assert.equal(bookings[1].version,1);assert.equal(bookings[1].room_id,2);
  await page.getByLabel('Показати',{exact:true}).selectOption('history');await page.getByText('Записано',{exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Підібрати час',exact:true}).count(),0);
  await page.getByRole('button',{name:'Мій профіль',exact:true}).click();await page.getByLabel('Поточний пароль',{exact:true}).fill('old');await page.getByLabel('Новий пароль',{exact:true}).fill('new');await page.getByLabel('Повторіть новий пароль',{exact:true}).fill('new');await page.getByRole('button',{name:'Змінити пароль',exact:true}).click();await page.getByRole('heading',{name:'Вхід до SOLVIA',exact:true}).waitFor();assert.equal(await page.evaluate(()=>sessionStorage.getItem('solvia_token')),null);
  assert.deepEqual(errors,[]);console.log('PASS: login, server connection, profile, password validation/logout, reception messaging restriction, waitlist search/create/ranges/consent/conflict/retry and duplicate-submit protection');
}finally{await browser.close();await new Promise(r=>server.close(r));}
