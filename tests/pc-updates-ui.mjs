// Shipped bundle: split workspaces, package distribution and persistent device login.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname} from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.SOLVIA_PLAYWRIGHT_MODULE||'playwright');
const root=resolve('frontend/dist');
const server=createServer(async(req,res)=>{try{
  const path=resolve(root,'.'+new URL(req.url,'http://localhost').pathname);
  if(path!==root&&!path.startsWith(root+'/')){res.writeHead(403).end();return;}
  const file=path===root?resolve(root,'index.html'):path;
  res.setHeader('Content-Type',({'.html':'text/html','.js':'application/javascript','.css':'text/css','.png':'image/png'})[extname(file)]||'application/octet-stream');
  res.end(await readFile(file));
}catch{res.writeHead(404).end();}});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser=await chromium.launch({headless:true,...(process.env.SOLVIA_CHROMIUM_EXECUTABLE?{executablePath:process.env.SOLVIA_CHROMIUM_EXECUTABLE,args:['--no-sandbox','--disable-dev-shm-usage']}:{})});
try {
  const context=await browser.newContext();
  await context.addInitScript(()=>Object.defineProperty(navigator,'platform',{get:()=> 'Win32'}));
  const bytes=Buffer.from('MZsynthetic-Windows-installer');let publication=null,logins=0;
  await context.route('**/api/**',async route=>{
    const req=route.request(),url=new URL(req.url()),path=url.pathname;let data=[];
    if(path==='/api/login'){logins++;data={token:'one-persistent-token',user:{id:1,name:'Тестовий адмін',role:'admin'}};}
    else if(path==='/api/me')data={id:1,name:'Тестовий адмін',role:'admin'};
    else if(path==='/api/health')data={ok:true,version:'3.1.0'};
    else if(path==='/api/stats')data={load:[],total_patients:0};
    else if(path==='/api/settings/center')data={center_name:'Тестовий центр'};
    else if(path==='/api/reception-access')data={allowed:true};
    else if(path==='/api/shift-day')data={open:true,shift_date:'2026-10-17'};
    else if(path==='/api/settings/workflow')data={opening_time:'08:00',closing_time:'20:00',working_days:'12345',slot_step_minutes:30,default_duration_minutes:60,session_hours:8};
    else if(path==='/api/desktop-updates'&&req.method()==='POST'){
      const body=req.postDataJSON();assert.equal(body.platform,'windows');assert.equal(Buffer.from(body.package_base64,'base64').toString(),bytes.toString());
      publication={...body,available:true,filename:'SOLVIA-3.1.0-Windows-x64.exe',size_bytes:bytes.length};data={ok:true};
    }
    else if(path==='/api/desktop-updates')data=url.searchParams.get('platform')?(publication||{available:false}):(publication?[publication]:[]);
    else if(path==='/api/desktop-updates/package'){await route.fulfill({body:bytes,contentType:'application/octet-stream'});return;}
    else if(path==='/api/mobile-update')data={available:false};
    await route.fulfill({json:data});
  });
  let page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const base=`http://127.0.0.1:${server.address().port}`;
  await page.goto(base);await page.getByPlaceholder('Ваш логін').fill('admin');await page.getByPlaceholder('Введіть пароль').fill('test-password');await page.getByRole('button',{name:'Увійти до SOLVIA',exact:true}).click();
  await page.getByRole('button',{name:'Налаштування центру',exact:true}).click();
  assert.equal(await page.locator('.settings-nav').getByRole('button',{name:/Оновлення/}).count(),0);
  await page.goto(base+'/?mode=server');
  await page.setViewportSize({width:1024,height:600});
  await page.getByText('SOLVIA Server Console 3.1.0',{exact:true}).waitFor();
  await page.getByRole('heading',{name:'Сервер центру 3.1.0',exact:true}).waitFor();
  await page.getByRole('button',{name:'Оновлення ПК',exact:true}).click();
  await page.getByLabel('Версія оновлення ПК').waitFor();
  const consolePanel=page.locator('.server-console');
  assert(await consolePanel.evaluate(el=>el.scrollHeight>el.clientHeight),'Console must overflow at a short viewport');
  await page.mouse.move(900,400);await page.mouse.wheel(0,10000);
  await page.waitForFunction(()=>document.querySelector('.server-console').scrollTop>0);
  const publishButton=page.getByRole('button',{name:'Опублікувати оновлення ПК',exact:true});
  await publishButton.scrollIntoViewIfNeeded();
  const box=await publishButton.boundingBox();assert(box.y>=0&&box.y+box.height<=600,'Bottom action remains reachable');
  await page.getByLabel('Версія оновлення ПК').fill('3.1.0');
  await page.getByLabel('Пакет оновлення ПК').setInputFiles({name:'SOLVIA.exe',mimeType:'application/octet-stream',buffer:bytes});
  await page.getByRole('button',{name:'Опублікувати оновлення ПК',exact:true}).click();
  await page.getByRole('status').filter({hasText:'Оновлення опубліковано.'}).waitFor();
  await page.close();page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
  await page.goto(base);await page.getByRole('button',{name:'Вийти',exact:true}).waitFor();assert.equal(logins,1,'A reopened program restores the same token instead of creating another session');
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Завантажити оновлення',exact:true}).click();const saved=await download;
  assert.equal(saved.suggestedFilename(),'SOLVIA-3.1.0-Windows-x64.exe');assert.equal((await readFile(await saved.path())).toString(),bytes.toString());
  await page.goto(base+'/?mode=server');await page.getByRole('button',{name:'Оновлення Android',exact:true}).click();await page.getByRole('heading',{name:'Оновлення Android',exact:true}).waitFor();assert.equal(logins,1);
  assert.deepEqual(errors,[]);
  console.log('PASS: separate main/Server Console, PC publishing/download and session survival after closing and reopening');
  await context.close();
}finally{await browser.close();await new Promise(r=>server.close(r));}
