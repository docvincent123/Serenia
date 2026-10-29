import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {request} from '../frontend/src/request.mjs';

let logoutBody='',logoutType='';
const server=createServer(async(req,res)=>{
 if(req.url==='/redirect'){res.writeHead(302,{Location:'/ok'}).end();return;}
 if(req.url==='/broken-body'){res.writeHead(200,{'Content-Length':100});res.write('{');setTimeout(()=>res.destroy(),10);return;}
 if(req.url==='/html'){res.writeHead(200,{'Content-Type':'text/html'}).end('<html>Proxy error</html>');return;}
 if(req.url==='/empty'){res.writeHead(200).end();return;}
 if(req.url==='/unauthorized'){res.writeHead(401,{'Content-Type':'application/json'}).end('{"error":"Сесія завершилася"}');return;}
 if(req.url==='/logout'){
  for await(const part of req)logoutBody+=part;
  logoutType=req.headers['content-type'];assert.equal(req.headers.authorization,'Bearer synthetic');
 }
 res.writeHead(200,{'Content-Type':'application/json'}).end('{"ok":true}');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
try{
 assert.deepEqual(await request(base,'','GET','/ok'),{ok:true});
 await request(base,'synthetic','POST','/logout');
 assert.equal(logoutBody,'{}');assert.equal(logoutType,'application/json');
 await assert.rejects(request(base,'','GET','/html'),e=>e.status===502);
 await assert.rejects(request(base,'','GET','/empty'),e=>e.status===502);
 await assert.rejects(request(base,'','GET','/unauthorized'),e=>e.status===401&&e.message==='Сесія завершилася');
 await assert.rejects(request(base,'','GET','/redirect'),e=>e.status===0);
 await assert.rejects(request(base,'','GET','/broken-body'),e=>e.status===0);
 console.log('PASS: JSON logout, authorization errors, redirects, empty/malformed responses and interrupted bodies');
}finally{await new Promise(resolve=>server.close(resolve));}
