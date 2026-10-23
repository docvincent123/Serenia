"""Real Ed25519 signatures: tampering, wrong centre, expiry and configuration."""
import base64,json,os,pathlib,subprocess,sys,tempfile,time
binary=str(pathlib.Path(sys.argv[1]).resolve())
with tempfile.TemporaryDirectory() as tmp:
 p=pathlib.Path(tmp);key=p/'private.pem';public=p/'public.pem';doc=p/'license.json'
 subprocess.run(['openssl','genpkey','-algorithm','Ed25519','-out',str(key)],check=True)
 subprocess.run(['openssl','pkey','-in',str(key),'-pubout','-out',str(public)],check=True)
 env={**os.environ,'SOLVIA_LICENSE_PUBLIC_KEY':str(public)}
 def status(*args,config=env):return json.loads(subprocess.check_output([binary,*map(str,args)],env=config))
 assert status(config={**env,'SOLVIA_LICENSE_PUBLIC_KEY':''})['status']=='unmanaged'
 assert status()['status']=='activation_required'
 def sign(expires):
  payload=json.dumps(dict(server_id='a'*64,center='Тестовий центр',license_id='test',expires_at=expires)).encode();(p/'data').write_bytes(payload)
  subprocess.run(['openssl','pkeyutl','-sign','-rawin','-inkey',str(key),'-in',str(p/'data'),'-out',str(p/'sig')],check=True)
  result=dict(format='quremed.solvia.license',payload=base64.b64encode(payload).decode(),signature=base64.b64encode((p/'sig').read_bytes()).decode());doc.write_text(json.dumps(result));return result
 active=sign(int(time.time())+3600)
 assert status(doc)['write_allowed'] is True
 assert status(doc,'b'*64)['status']=='invalid'
 changed={**active,'payload':base64.b64encode(b'{}').decode()};doc.write_text(json.dumps(changed));assert status(doc)['status']=='invalid'
 changed={**active,'signature':'!!!!'};doc.write_text(json.dumps(changed));assert status(doc)['status']=='invalid'
 sign(int(time.time())-1);assert status(doc)['status']=='expired';assert status(doc)['write_allowed'] is False
 assert status(doc,config={**env,'SOLVIA_LICENSE_PUBLIC_KEY':str(p/'missing')})['status']=='invalid'
print('Centre licensing: 8 cryptographic and access-policy checks passed')
