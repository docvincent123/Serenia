#!/usr/bin/env python3
"""Unit + HTTP contract checks for the company-only metadata registry."""
import http.client
import importlib.util
import json
import os
from pathlib import Path
import sqlite3
import tempfile
import threading
import unittest

MODULE_PATH=Path(__file__).resolve().parents[1]/'server.py'
spec=importlib.util.spec_from_file_location('operator_hub',MODULE_PATH)
hub=importlib.util.module_from_spec(spec)
spec.loader.exec_module(hub)

class RegistryTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='lemvori-registry-test-')
        self.old_path=hub.DB_PATH
        self.old_origin=hub.ORIGIN
        self.old_user=os.environ.get('HUB_ADMIN_USER')
        self.old_password=os.environ.get('HUB_ADMIN_PASSWORD')
        hub.DB_PATH=Path(self.tmp.name)/'registry.sqlite3'
        hub.ORIGIN='https://operator.example.test'
        os.environ['HUB_ADMIN_USER']='companyadmin'
        os.environ['HUB_ADMIN_PASSWORD']='test-only-long-secret-123'
        hub.bootstrap()

    def tearDown(self):
        hub.DB_PATH=self.old_path
        hub.ORIGIN=self.old_origin
        for k,value in [('HUB_ADMIN_USER',self.old_user),('HUB_ADMIN_PASSWORD',self.old_password)]:
            if value is None:os.environ.pop(k,None)
            else:os.environ[k]=value
        self.tmp.cleanup()

    def test_center_id_unique_and_token_hash(self):
        db=hub.connect()
        try:
            center=hub.add_center(db,'Тестовий центр','Івано-Франківськ','a'*64,'companyadmin')
            self.assertEqual(len(center['id']),36)
            row=db.execute('SELECT * FROM centers WHERE id=?',(center['id'],)).fetchone()
            self.assertEqual(row['name'],'Тестовий центр')
            self.assertNotEqual(row['token_hash'],center['center_token'])
            self.assertEqual(row['token_hash'],hub.secret_hash(center['center_token']))
            with self.assertRaises(sqlite3.IntegrityError):
                hub.add_center(db,'Другий центр','Львів','a'*64,'companyadmin')
            self.assertEqual(db.execute('SELECT count(*) FROM centers').fetchone()[0],1)
        finally:db.close()

    def test_signed_identity_heartbeat_cannot_change_registry_or_send_clinical_data(self):
        db=hub.connect()
        try:
            center=hub.add_center(db,'Перший центр','','b'*64,'companyadmin')
            self.assertFalse(hub.update_heartbeat(db,'fake-token',{'server_id':'b'*64}))
            self.assertFalse(hub.update_heartbeat(db,center['center_token'],{'server_id':'c'*64}))
            self.assertFalse(hub.update_heartbeat(db,center['center_token'],{'server_id':'b'*64,'backup_status':'patient_record'}))
            self.assertTrue(hub.update_heartbeat(db,center['center_token'],{'server_id':'b'*64,'version':'3.1.1','backup_status':'ok','last_backup_at':'2026-11-09T19:00:00Z','patient_name':'must-not-appear'}))
            row=db.execute('SELECT * FROM centers').fetchone()
            self.assertEqual(row['name'],'Перший центр')
            self.assertEqual(row['backup_status'],'ok')
            self.assertNotIn('patient_name',dict(row))
            self.assertNotIn(b'must-not-appear',hub.DB_PATH.read_bytes())
        finally:db.close()

    def test_authentication_csrf_and_operator_only_registration(self):
        server=hub.ThreadingHTTPServer(('127.0.0.1',0),hub.Handler)
        thread=threading.Thread(target=server.serve_forever,daemon=True)
        thread.start()
        try:
            def request(method,path,data=None,cookie='',csrf='',origin='https://operator.example.test'):
                conn=http.client.HTTPConnection('127.0.0.1',server.server_address[1],timeout=10)
                headers={'Origin':origin,'Content-Type':'application/json'}
                if cookie:headers['Cookie']=cookie
                if csrf:headers['X-CSRF']=csrf
                conn.request(method,path,body=json.dumps(data) if data is not None else None,headers=headers)
                response=conn.getresponse()
                status=response.status
                body=json.loads(response.read() or b'{}')
                saved_cookie=response.getheader('Set-Cookie','')
                conn.close()
                return status,body,saved_cookie
            self.assertEqual(request('GET','/api/centers')[0],401)
            self.assertEqual(request('POST','/api/login',{'username':'companyadmin','password':'test-only-long-secret-123'},origin='https://attacker.example')[0],403)
            status,data,saved=request('POST','/api/login',{'username':'companyadmin','password':'test-only-long-secret-123'})
            self.assertEqual(status,200)
            self.assertIn('Secure',saved)
            self.assertIn('HttpOnly',saved)
            self.assertIn('SameSite=Strict',saved)
            cookie=saved.split(';')[0]
            self.assertEqual(request('POST','/api/centers',{'name':'Centre','server_id':'c'*64},cookie=cookie)[0],403)
            status,created,_=request('POST','/api/centers',{'name':'Центр 1','city':'Львів','server_id':'c'*64},cookie=cookie,csrf=data['csrf'])
            self.assertEqual(status,201)
            self.assertTrue(len(created['center_token'])>40)
            status,listed,_=request('GET','/api/centers',cookie=cookie)
            self.assertEqual(status,200)
            self.assertEqual(len(listed['centers']),1)
            self.assertNotIn('center_token',listed['centers'][0])
            self.assertNotIn('token_hash',listed['centers'][0])
            self.assertEqual(request('POST','/api/heartbeat',{'server_id':'c'*64,'backup_status':'ok'},cookie=cookie)[0],401)
            # Hub does not need a center's account password or patient's notes.
            status,_,_=request('POST','/api/logout',{},cookie=cookie,csrf=data['csrf'])
            self.assertEqual(status,200)
            self.assertEqual(request('GET','/api/centers',cookie=cookie)[0],401)
        finally:
            server.shutdown();server.server_close();thread.join(timeout=4)

if __name__=='__main__':
    unittest.main()
