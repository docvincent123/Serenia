#!/usr/bin/env python3
"""Offline publisher tool. Never distribute the private key to a centre."""
import argparse,base64,datetime,json,re,subprocess,tempfile,uuid
from pathlib import Path
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--key',required=True,help='Publisher Ed25519 private PEM key')
p.add_argument('--server-id',required=True)
p.add_argument('--center',required=True)
p.add_argument('--expires',required=True,help='Exclusive expiry, ISO 8601 with timezone, e.g. 2027-10-23T00:00:00+03:00')
p.add_argument('--output',required=True)
a=p.parse_args()
if not re.fullmatch('[a-f0-9]{64}',a.server_id):p.error('Invalid server ID')
if not a.center.strip() or len(a.center.encode())>200:p.error('Invalid centre name')
expiry=datetime.datetime.fromisoformat(a.expires)
if expiry.tzinfo is None:p.error('Expiry must include timezone')
if expiry<=datetime.datetime.now(datetime.timezone.utc):p.error('Expiry must be in the future')
payload=json.dumps(dict(server_id=a.server_id,center=a.center,expires_at=int(expiry.timestamp()),license_id=str(uuid.uuid4())),ensure_ascii=False,separators=(',',':')).encode()
with tempfile.TemporaryDirectory() as folder:
    source=Path(folder)/'payload';signature=Path(folder)/'signature';source.write_bytes(payload)
    subprocess.run(['openssl','pkeyutl','-sign','-rawin','-inkey',a.key,'-in',str(source),'-out',str(signature)],check=True)
    envelope=dict(format='quremed.solvia.license',payload=base64.b64encode(payload).decode(),signature=base64.b64encode(signature.read_bytes()).decode())
    with open(a.output,'x',encoding='utf-8') as output:json.dump(envelope,output,ensure_ascii=False,indent=2)
print('License created:',a.output)
