"""Exercise the real C++ HTTP server and PostgreSQL database, with synthetic data."""
import base64
import hashlib
import concurrent.futures
import datetime as dt
import json
import os
import pathlib
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import urllib.request
import urllib.error
import urllib.parse

BINARY = str(pathlib.Path(sys.argv.pop(1)).resolve())

class Scenario(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.update_dir=tempfile.TemporaryDirectory()
        os.environ['SOLVIA_MOBILE_UPDATE_DIR']=cls.update_dir.name
        os.environ['SOLVIA_DESKTOP_UPDATE_DIR']=str(pathlib.Path(cls.update_dir.name)/'pc')
        os.environ['SOLVIA_TV_SITE_ORIGIN']='https://solvia-test.netlify.app'
        cls.database = os.environ.get('SOLVIA_TEST_DATABASE_URL', '')
        if not cls.database:
            raise RuntimeError('SOLVIA_TEST_DATABASE_URL is required')
        output = subprocess.check_output([BINARY, '--database', cls.database, '--demo'], text=True, encoding='utf-8')
        # Re-running setup must preserve existing users and their credentials.
        subprocess.check_call([BINARY, '--database', cls.database, '--init'])
        cls.passwords = dict(line.split(': ', 1) for line in output.splitlines() if ': ' in line)
        with socket.socket() as s:
            s.bind(('127.0.0.1', 0)); cls.port = s.getsockname()[1]
        cls.base = f'http://127.0.0.1:{cls.port}'
        cls.start()
        cls.tokens = {}
        for role, password in cls.passwords.items():
            code, body = cls.call('POST', '/api/login', {'login':role, 'password':password, 'platform':'CI-'+role,'device_id':'ci-'+role,'device_name':'Synthetic device'})
            assert code == 200, (code, body)
            cls.tokens[role] = body['token']
    @classmethod
    def start(cls):
        cls.proc = subprocess.Popen([BINARY, '--database', cls.database, '--port', str(cls.port)], stdout=subprocess.DEVNULL)
        for _ in range(100):
            try:
                cls.call('GET', '/api/me'); return
            except OSError:
                time.sleep(.05)
        raise RuntimeError('Server failed to start')
    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate(); cls.proc.wait(timeout=10)
    @classmethod
    def call(cls, method, path, body=None, token=None):
        headers={'Content-Type':'application/json'}
        if token: headers['Authorization']='Bearer '+token
        req=urllib.request.Request(cls.base+path, data=None if body is None else json.dumps(body).encode(), headers=headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=15) as r: return r.status, json.load(r)
        except urllib.error.HTTPError as e: return e.code, json.load(e)
    def api(self, role, method, path, body=None, status=200):
        code, result=self.call(method,path,body,self.tokens.get(role))
        self.assertEqual(code,status,result)
        return result
    def test_a0_live_workflow_events_and_tv(self):
        def sql(statement):
            return subprocess.check_output(['psql',self.database,'-X','-qAt','-v','ON_ERROR_STOP=1','-c',statement],text=True).strip()
        day=dt.date.today().isoformat()
        original_shift=self.api('admin','GET','/api/shift-day')
        policy=self.api('admin','GET','/api/settings/workflow')
        aid=patient=room=other=None;tv_device=None
        self.api('admin','POST','/api/reception-access',{'access_date':day,'start_time':'00:00','enabled':True})
        self.api('admin','PATCH','/api/settings/workflow',{'opening_time':'00:00','closing_time':'23:59','working_days':'1234567'})
        try:
            baseline=self.api('admin','GET','/api/workflow-events')
            self.assertTrue(baseline['initial'])
            self.api('admin','GET','/api/workflow-events?after=-1',status=400)
            psy=self.api('psychologist','GET','/api/me')['id']
            other=self.api('admin','POST','/api/users',{'name':'Я тестовий інший психолог','login':'workflow-other','password':'workflow-test-password','role':'psychologist'})['id']
            _,auth=self.call('POST','/api/login',{'login':'workflow-other','password':'workflow-test-password','platform':'CI'})
            room=self.api('admin','POST','/api/rooms',{'name':'Workflow integration room'})['id']
            patient=self.api('admin','POST','/api/patients',{'name':'Тестовий Пацієнт Подій','phone':'+380000004444','dob':'1991-01-01','category':'Інше','psychologist_id':psy})['id']
            minute=min(1410,dt.datetime.now().hour*60+dt.datetime.now().minute)
            clock=lambda n:f'{n//60:02d}:{n%60:02d}'
            booking={'psychologist_id':psy,'room_id':room,'patient_ids':[patient],'kind':'individual','start':day+'T'+clock(minute),'end':day+'T'+clock(minute+29)}
            aid=self.api('admin','POST','/api/appointments',booking)['id']
            cursor=baseline['cursor']
            own=self.api('psychologist','GET',f'/api/workflow-events?after={cursor}')
            self.assertTrue(any(e['kind']=='appointment.created' and e['appointment_id']==aid for e in own['events']))
            self.assertEqual(self.call('GET',f'/api/workflow-events?after={cursor}',token=auth['token'])[1]['events'],[])
            payload={'appointment_id':aid,'patient_id':patient}
            after_created=own['cursor']
            self.api('admin','POST','/api/tv/call',payload,status=409)
            self.assertEqual(self.api('admin','GET',f'/api/workflow-events?after={after_created}')['events'],[],'Failed writes do not emit events')
            self.api('admin','POST',f'/api/appointments/{aid}/arrival',{'patient_id':patient})
            self.api('admin','POST',f'/api/appointments/{aid}/arrival',{'patient_id':patient})
            self.api('admin','POST','/api/tv/call',payload)
            pair=self.call('POST','/api/tv/pair',{})[1]
            tv_device=self.api('admin','POST','/api/admin/tv-displays',{'code':pair['code'],'name':'Workflow TV','room_id':room,'message':'Test','page_seconds':6,'show_full_names':False,'enabled':True})['id']
            feed=self.call('GET','/api/tv/schedule',token=pair['token'])[1]
            self.assertEqual(next(e for e in feed['entries'] if e['appointment_id']==aid)['state'],'called')
            self.api('psychologist','POST',f'/api/appointments/{aid}/start',{'patient_id':patient})
            self.api('psychologist','POST','/api/consultations',{'patient_id':patient,'appointment_id':aid,'note':'PRIVATE_WORKFLOW_TEST_DO_NOT_LEAK'})
            events=self.api('psychologist','GET',f'/api/workflow-events?after={cursor}')['events']
            self.assertEqual([e['kind'] for e in events].count('patient.arrived'),1)
            self.assertTrue(any(e['kind']=='consultation.completed' for e in events))
            self.assertNotIn('PRIVATE_WORKFLOW_TEST_DO_NOT_LEAK',json.dumps(events))
            director=self.api('director','GET',f'/api/workflow-events?after={cursor}')['events']
            self.assertTrue(director)
            self.assertTrue(all('patient_id' not in e and 'appointment_id' not in e for e in director))
            self.assertFalse(any(e['appointment_id']==aid for e in self.call('GET','/api/tv/schedule',token=pair['token'])[1]['entries']))
        finally:
            if tv_device:self.api('admin','DELETE',f'/api/admin/tv-displays/{tv_device}',{})
            if aid:sql(f'DELETE FROM consultations WHERE appointment_id={aid}; DELETE FROM appointments WHERE id={aid}')
            if patient:sql(f'DELETE FROM patients WHERE id={patient}')
            if room:sql(f'DELETE FROM rooms WHERE id={room}')
            if other:sql(f'DELETE FROM audit WHERE user_id={other}; DELETE FROM users WHERE id={other}')
            self.api('admin','PATCH','/api/settings/workflow',{k:v for k,v in policy.items() if k!='id'})
            if not original_shift.get('open'):
                sql("DELETE FROM reception_access WHERE access_date='"+day+"'; DELETE FROM shift_days WHERE shift_date='"+day+"'")

    def test_a1_booking_receipt_and_rescheduling_slots(self):
        """A lost booking acknowledgement can be replayed without duplicate work."""
        def sql(statement):
            return subprocess.check_output(['psql',self.database,'-X','-qAt','-v','ON_ERROR_STOP=1','-c',statement],text=True).strip()
        policy=self.api('admin','GET','/api/settings/workflow')
        original_shift=self.api('admin','GET','/api/shift-day')
        psy=self.api('psychologist','GET','/api/me')['id']
        room=patient=aid=None
        self.api('admin','POST','/api/shift-day',{'action':'open'})
        self.api('admin','PATCH','/api/settings/workflow',{'opening_time':'08:00','closing_time':'20:00','working_days':'1234567'})
        try:
            room=self.api('admin','POST','/api/rooms',{'name':'Booking receipt synthetic room'})['id']
            patient=self.api('admin','POST','/api/patients',{'name':'Booking receipt synthetic patient','phone':'+380000006677','dob':'1992-01-01','category':'Інше','psychologist_id':psy})['id']
            day=(dt.date.today()+dt.timedelta(days=7)).isoformat()
            body={'psychologist_id':psy,'room_id':room,'patient_ids':[patient],'kind':'individual','start':day+'T09:00','end':day+'T10:00','client_key':'synthetic-booking-receipt-1'}
            aid=self.api('admin','POST','/api/appointments',body)['id']
            repeated=self.api('admin','POST','/api/appointments',body)
            self.assertEqual(repeated,{'id':aid,'already_saved':True})
            with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
                results=list(pool.map(lambda _:self.call('POST','/api/appointments',body,self.tokens['admin']),range(2)))
            self.assertTrue(all(code==200 and result['id']==aid for code,result in results))
            self.assertEqual(int(sql(f"SELECT count(*) FROM audit WHERE entity='appointment' AND event='save' AND entity_id={aid}")),1)
            self.assertEqual(int(sql(f"SELECT count(*) FROM appointment_requests WHERE appointment_id={aid}")),1)
            self.api('admin','POST','/api/appointments',{**body,'note':'changed after acknowledgement'},status=409)
            self.api('admin','POST','/api/appointments',{**body,'client_key':'bad'},status=400)
            self.api('psychologist','POST','/api/appointments',body,status=403)
            url=f'/api/slots?date={day}&psychologist_id={psy}&room_id={room}'
            self.assertNotIn('09:00',self.api('admin','GET',url))
            self.assertIn('09:00',self.api('admin','GET',url+f'&exclude_appointment_id={aid}'))
            for invalid in ('0','-1','1x','99999999999999999999'):
                self.api('admin','GET',url+'&exclude_appointment_id='+invalid,status=400)
            self.api('admin','GET',url+'&exclude_appointment_id=999999999',status=404)
            sql(f"UPDATE appointments SET status='completed' WHERE id={aid}")
            self.api('admin','GET',url+f'&exclude_appointment_id={aid}',status=409)
        finally:
            if aid:sql(f'DELETE FROM appointments WHERE id={aid}')
            if patient:sql(f'DELETE FROM patients WHERE id={patient}')
            if room:sql(f'DELETE FROM rooms WHERE id={room}')
            self.api('admin','PATCH','/api/settings/workflow',{k:v for k,v in policy.items() if k!='id'})
            if not original_shift.get('open'):
                sql("DELETE FROM shift_days WHERE shift_date='"+dt.date.today().isoformat()+"'")

    def test_a_local_desktop_cors(self):
        for method in ('GET','OPTIONS'):
            for origin in ('solvia://app','https://app.solvia.invalid','https://untrusted.invalid'):
                request=urllib.request.Request(self.base+'/api/health',headers={'Origin':origin},method=method)
                with urllib.request.urlopen(request) as response:
                    expected='solvia://app' if origin=='solvia://app' else 'https://app.solvia.invalid'
                    self.assertEqual(response.headers.get_all('Access-Control-Allow-Origin'),[expected])
                    self.assertIn('Origin',response.headers['Vary'])

    def test_a_tv_site_cors_is_limited_to_display_endpoints(self):
        for site in ['https://solvia-tv-display.mykhailoyurkevich123.chatgpt.site',os.environ['SOLVIA_TV_SITE_ORIGIN']]:
            for path in ['/api/tv/pair','/api/tv/pairing','/api/tv/schedule','/api/patients','/api/login']:
                request=urllib.request.Request(self.base+path,headers={'Origin':site,'Access-Control-Request-Private-Network':'true'},method='OPTIONS')
                with urllib.request.urlopen(request) as response:
                    allowed=path.startswith('/api/tv/')
                    self.assertEqual(response.headers['Access-Control-Allow-Origin'],site if allowed else 'https://app.solvia.invalid')
                    self.assertEqual(response.headers.get('Access-Control-Allow-Private-Network'),'true' if allowed else None)
        request=urllib.request.Request(self.base+'/api/tv/schedule',headers={'Origin':'https://untrusted.invalid','Access-Control-Request-Private-Network':'true'},method='OPTIONS')
        with urllib.request.urlopen(request) as response:
            self.assertNotEqual(response.headers['Access-Control-Allow-Origin'],'https://untrusted.invalid')
            self.assertIsNone(response.headers.get('Access-Control-Allow-Private-Network'))

    def test_a_tv_display_pairing_scope_and_live_schedule(self):
        def tv(method,path,body=None,key=None):
            return self.call(method,path,body,key)
        def sql(statement):
            return subprocess.check_output(['psql',self.database,'-X','-qAt','-v','ON_ERROR_STOP=1','-c',statement],text=True).strip()
        self.assertEqual(tv('GET','/api/tv/schedule')[0],401)
        code,pair=tv('POST','/api/tv/pair',{})
        self.assertEqual(code,200)
        self.assertRegex(pair['code'],r'^\d{6}$')
        key=pair['token']
        self.assertEqual(tv('GET','/api/tv/pairing',key=key)[1],{'paired':False})
        self.assertEqual(tv('GET','/api/tv/schedule',key=key)[0],401)
        self.assertEqual(tv('GET','/api/patients',key=key)[0],401)
        self.assertEqual(tv('GET','/api/admin/tv-displays',key=key)[0],401)
        form={'code':pair['code'],'name':'Synthetic TV','room_id':0,'message':'Welcome','page_seconds':6,'show_full_names':True,'enabled':True}
        device=self.api('admin','POST','/api/admin/tv-displays',form)
        self.assertNotIn('token_hash',device)
        self.api('admin','POST','/api/admin/tv-displays',form,status=409)
        self.assertEqual(tv('GET','/api/tv/pairing',key=key)[1],{'paired':True})
        self.assertEqual(tv('GET','/api/me',key=key)[0],401)
        psy=self.api('admin','GET','/api/meta')['psychologists'][0]['id']
        room=self.api('admin','POST','/api/rooms',{'name':'TV integration test room'})['id']
        patient=self.api('admin','POST','/api/patients',{'name':'Тестовий Іван Іванович','phone':'+380000001234','dob':'1990-01-01','category':'Інше','psychologist_id':psy})['id']
        day=dt.date.today().isoformat()
        aid=int(sql(f"INSERT INTO appointments(psychologist_id,room_id,start,\"end\",kind,status,created) VALUES({psy},{room},'{day}T00:00','{day}T23:59','individual','scheduled','{day}T00:00:00') RETURNING id"))
        sql(f"INSERT INTO attendees(appointment_id,patient_id) VALUES({aid},{patient})")
        try:
            feed=tv('GET','/api/tv/schedule',key=key)[1]
            entry=next(row for row in feed['entries'] if row['appointment_id']==aid)
            self.assertEqual(entry['patient'],'Тестовий Іван Іванович')
            self.assertNotIn('phone',entry);self.assertNotIn('note',entry)
            payload={'appointment_id':aid,'patient_id':patient}
            self.api('admin','POST','/api/tv/call',payload,status=409)
            sql(f"UPDATE attendees SET arrived_at='{day}T00:00:01' WHERE appointment_id={aid}")
            self.api('admin','POST','/api/tv/call',payload)
            entry=next(row for row in tv('GET','/api/tv/schedule',key=key)[1]['entries'] if row['appointment_id']==aid)
            self.assertEqual(entry['state'],'called')
            self.api('admin','PATCH','/api/admin/tv-displays/'+str(device['id']),{**form,'room_id':room,'show_full_names':False})
            feed=tv('GET','/api/tv/schedule',key=key)[1]
            self.assertTrue(all(row['room']=='TV integration test room' for row in feed['entries']))
            self.assertEqual(feed['entries'][0]['patient'],'Тестовий І. І.')
            self.api('admin','DELETE','/api/tv/call',payload)
            sql(f"UPDATE appointments SET status='cancelled' WHERE id={aid}")
            self.assertFalse(tv('GET','/api/tv/schedule',key=key)[1]['entries'])
            self.api('admin','PATCH','/api/admin/tv-displays/'+str(device['id']),{**form,'enabled':False})
            self.assertEqual(tv('GET','/api/tv/schedule',key=key)[0],403)
            self.api('admin','DELETE','/api/admin/tv-displays/'+str(device['id']),{})
            self.assertEqual(tv('GET','/api/tv/schedule',key=key)[0],401)
            expired=tv('POST','/api/tv/pair',{})[1]
            sql(f"UPDATE tv_pairings SET expires=0 WHERE code='{expired['code']}'")
            self.assertEqual(tv('GET','/api/tv/pairing',key=expired['token'])[0],401)
        finally:
            sql(f"DELETE FROM appointments WHERE id={aid}; DELETE FROM patients WHERE id={patient}; DELETE FROM rooms WHERE id={room}")

    def test_a_pc_update_distribution(self):
        self.assertEqual(self.call('GET','/api/desktop-updates')[0],401)
        self.assertFalse(self.api('director','GET','/api/desktop-updates?platform=windows')['available'])
        for platform, content in [('windows', b'MZsynthetic-SOLVIA-installer'),('linux', b'\x1f\x8bsynthetic-SOLVIA-client')]:
            sha=hashlib.sha256(content).hexdigest()
            payload={'platform':platform,'version':'2.5.2','sha256':sha,'package_base64':base64.b64encode(content).decode(),'release_notes':'Synthetic PC package'}
            self.api('reception','POST','/api/desktop-updates',payload,status=403)
            self.api('admin','POST','/api/desktop-updates',{**payload,'sha256':'0'*64},status=400)
            self.api('admin','POST','/api/desktop-updates',payload)
            info=self.api('director','GET','/api/desktop-updates?platform='+platform)
            self.assertEqual(info['sha256'],sha);self.assertTrue(info['available']);self.assertNotIn('desktop_file',info)
            request=urllib.request.Request(self.base+'/api/desktop-updates/package?platform='+platform+'&sha='+sha,headers={'Authorization':'Bearer '+self.tokens['director']})
            with urllib.request.urlopen(request) as response:self.assertEqual(response.read(),content)
            self.api('admin','POST','/api/desktop-updates',{**payload,'version':'2.5.1'},status=409)
            self.api('director','DELETE','/api/desktop-updates?platform='+platform,{},status=403)
            self.api('admin','DELETE','/api/desktop-updates?platform='+platform,{})
            self.assertFalse(self.api('director','GET','/api/desktop-updates?platform='+platform)['available'])
            self.api('director','GET','/api/desktop-updates/package?platform='+platform+'&sha='+sha,status=404)
        self.api('admin','POST','/api/desktop-updates',{'platform':'../../evil'},status=400)

    def test_a_scoped_settings_preserve_other_program(self):
        original=self.api('admin','GET','/api/settings/center')
        self.api('admin','PATCH','/api/settings/center',{'server_name':'Server Console test','vps_name':'Scoped VPS'})
        server_saved=self.api('admin','GET','/api/settings/center')
        self.assertEqual(server_saved['center_name'],original['center_name'])
        self.assertEqual(server_saved['logo_data'],original['logo_data'])
        self.api('admin','PATCH','/api/settings/center',{'center_name':'Clinical workspace test'})
        clinic_saved=self.api('admin','GET','/api/settings/center')
        self.assertEqual(clinic_saved['server_name'],'Server Console test')
        self.assertEqual(clinic_saved['vps_name'],'Scoped VPS')
        self.api('admin','PATCH','/api/settings/center',original)

    def test_b_single_session_across_devices(self):
        uid=self.api('admin','POST','/api/users',{'name':'Single session test','login':'single-session','password':'single-session-password','role':'reception'})['id']
        def login(device, password='single-session-password'):
            return self.call('POST','/api/login',{'login':'single-session','password':password,'platform':device,'device_id':device})
        code, first=login('Windows')
        self.assertEqual(code,200,first)
        self.assertEqual(login('Linux','wrong-password')[0],401)
        self.assertEqual(login('Linux')[0],409)
        self.assertEqual(self.call('GET','/api/me',token=first['token'])[0],200)
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            denied=list(pool.map(login,['Android','Windows','Linux']))
        self.assertTrue(all(code==409 and 'token' not in body for code,body in denied),denied)
        self.assertEqual(self.call('GET','/api/me',token=first['token'])[0],200)
        self.assertEqual(self.call('POST','/api/logout',{},first['token'])[0],200)
        with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
            results=list(pool.map(login,['Android','Windows','Linux']))
        successful=[auth for code,auth in results if code==200]
        self.assertEqual(len(successful),1,results)
        self.assertEqual(sum(code==409 for code,_ in results),2,results)
        sessions=[row for row in self.api('admin','GET','/api/admin/sessions') if row['user_id']==uid]
        self.assertEqual(len(sessions),1)
        self.api('admin','DELETE',f'/api/users/{uid}/sessions',{})
        self.assertEqual(login('Linux')[0],200)
        self.api('admin','DELETE',f'/api/users/{uid}/sessions',{})

    def test_plain_http_must_not_bind_to_the_lan(self):
        # Windows exposes LAN traffic through Caddy HTTPS only. Regression guard
        # for accidentally starting the raw HTTP API on 0.0.0.0 without TLS.
        with socket.socket() as listener:
            listener.bind(('127.0.0.1', 0))
            port = listener.getsockname()[1]
        result = subprocess.run(
            [BINARY, '--database', self.database, '--host', '0.0.0.0', '--port', str(port)],
            capture_output=True, text=True, encoding='utf-8', timeout=20
        )
        self.assertEqual(result.returncode, 1, (result.stdout, result.stderr))
        self.assertIn('Direct LAN access is disabled; use the local HTTPS reverse proxy', result.stderr)

    def test_end_to_end_and_privacy(self):
        self.api(None,'GET','/api/patients',status=401)
        admin='admin'; rec='reception'; psy='psychologist'; director='director'
        self.assertFalse(self.api(psy,'GET','/api/mobile-update')['available'])
        apk=b'PK\x03\x04'+b'synthetic-update-only'
        sha=hashlib.sha256(apk).hexdigest()
        release={'version_code':100,'version_name':'test-100','package_name':'com.quremed.solvia','sha256':sha,'apk_base64':base64.b64encode(apk).decode(),'release_notes':'Synthetic test'}
        self.api(rec,'POST','/api/mobile-update',release,status=403)
        self.api(psy,'POST','/api/mobile-update',release,status=403)
        self.api(admin,'POST','/api/mobile-update',{**release,'sha256':'0'*64},status=400)
        self.api(admin,'POST','/api/mobile-update',release)
        info=self.api(psy,'GET','/api/mobile-update')
        self.assertEqual(info['version_code'],100)
        self.assertNotIn('apk_base64',info)
        request=urllib.request.Request(self.base+'/api/mobile-update/apk?sha='+sha,headers={'Authorization':'Bearer '+self.tokens[psy]})
        with urllib.request.urlopen(request) as response:self.assertEqual(response.read(),apk)
        self.api(admin,'POST','/api/mobile-update',{**release,'version_code':99},status=409)
        self.api(admin,'POST','/api/mobile-update',{**release,'package_name':'com.other.app'},status=400)
        self.api(psy,'GET','/api/mobile-update/apk?sha=../secret',status=400)
        self.api(admin,'POST','/api/mobile-update',{**release,'rollout_user_ids':[3]})
        self.assertTrue(self.api(psy,'GET','/api/mobile-update')['available'])
        self.assertFalse(self.api(rec,'GET','/api/mobile-update')['available'])
        self.api(admin,'POST','/api/mobile-update',{**release,'rollout_user_ids':[]})
        shift=self.api(admin,'GET','/api/shift-day')
        self.assertFalse(shift['open'])
        shift=self.api(admin,'POST','/api/shift-day',{'action':'open'})
        today=dt.date.today().isoformat()
        grant={'access_date':today,'start_time':'00:00'}
        self.api(rec,'POST','/api/reception-access',grant,status=403)
        self.api(director,'POST','/api/reception-access',grant,status=403)
        self.api(admin,'POST','/api/reception-access',{**grant,'start_time':'25:00'},status=400)
        self.api(admin,'POST','/api/reception-access',{**grant,'enabled':False})
        self.assertFalse(self.api(rec,'GET','/api/reception-access')['allowed'])
        self.assertTrue(self.api(admin,'GET','/api/shift-day')['open'])
        self.api(rec,'POST','/api/patients',{},status=423)
        # A future day's grant must not unlock today's work.
        self.api(admin,'POST','/api/reception-access',{**grant,'access_date':(dt.date.today()+dt.timedelta(days=1)).isoformat()})
        self.assertFalse(self.api(rec,'GET','/api/reception-access')['allowed'])
        self.api(admin,'POST','/api/reception-access',grant)
        self.assertTrue(self.api(rec,'GET','/api/reception-access')['allowed'])

        self.assertTrue(shift['open'])
        other=self.api(admin,'POST','/api/users',{'name':'Інший психолог','login':'other','phone':'+380501112233','password':'long-test-password','role':'psychologist'})['id']
        _,auth=self.call('POST','/api/login',{'login':'other','password':'long-test-password','platform':'Android','device_id':'other-test-phone'})
        self.tokens['other']=auth['token']
        device_sessions=self.api(admin,'GET','/api/admin/sessions')
        self.assertTrue(any(x['name']=='Інший психолог' and x['platform']=='Android' for x in device_sessions))
        managed=self.api(admin,'POST','/api/users',{'name':'Керований працівник','login':'managed','phone':'+380671234567','password':'managed-test-password','role':'reception'})['id']
        self.api(admin,'PATCH',f'/api/users/{managed}',{'role':'psychologist','phone':'+380679999999','active':True})
        managed_row=next(x for x in self.api(admin,'GET','/api/users') if x['id']==managed)
        self.assertEqual(managed_row['role'],'psychologist')
        self.assertTrue(managed_row['active'])
        self.assertEqual(managed_row['phone'],'+380679999999')
        other_row=next(x for x in self.api(admin,'GET','/api/users') if x['id']==other)
        self.assertEqual(other_row['active_sessions'],1)
        self.assertIn('Android',other_row['platforms'])
        self.api(admin,'PATCH','/api/users/1',{'active':False},status=409)
        family=self.api(rec,'POST','/api/families',{'name':'Тестова сім’я'})['id']
        p={'name':'Тестовий Пацієнт','phone':'+380000000000','dob':'1990-01-01','category':'Ветеран/ветеранка','psychologist_id':3,'family_id':family,'family_role':'Військовий','referral_source':'Військова частина','referral_source_details':'Тестовий підрозділ','course_reason':'Первинне звернення'}
        created_patient=self.api(rec,'POST','/api/patients',p)
        pid=created_patient['id']
        self.assertEqual(len(created_patient['patient_no']),5)
        self.assertTrue(created_patient['patient_no'].isdigit())
        self.api(rec,'POST','/api/patients',p,status=409)
        second=self.api(rec,'POST','/api/patients',{**p,'name':'Інший член сім’ї','psychologist_id':other})['id']
        self.assertEqual([x['id'] for x in self.api(psy,'GET','/api/patients')],[pid])
        self.api('other','GET',f'/api/patients/{pid}',status=403)
        self.api(psy,'GET',f'/api/patients/{second}',status=403)
        self.api(director,'GET','/api/patients',status=403)
        self.api(director,'GET',f'/api/patients/{pid}',status=403)
        self.api(director,'GET','/api/appointments',status=403)
        # Search must enforce the same privacy boundary as the patient card.
        query='/api/search?q='+urllib.parse.quote('Ветеран')
        self.api(director,'GET',query,status=403)
        self.assertEqual({x['id'] for x in self.api(psy,'GET',query)['patients']},{pid})
        self.assertEqual({x['id'] for x in self.api('other','GET',query)['patients']},{second})
        self.assertEqual({x['id'] for x in self.api(rec,'GET',query)['patients']},{pid,second})
        self.assertEqual(self.api(psy,'GET','/api/search?q='+urllib.parse.quote('Тестова'))['families'],[])
        # Editing cannot assign a patient to a non-psychologist or corrupt demographics.
        for bad in ({'psychologist_id':1},{'dob':'2999-01-01'},{'phone':'abc'},{'category':'invalid'}):
            self.api(rec,'PATCH',f'/api/patients/{pid}',bad,status=400)
        self.api(rec,'PATCH',f'/api/patients/{second}',{'psychologist_id':3})
        self.assertEqual(self.api(rec,'GET',f'/api/patients/{second}')['courses'][0]['psychologist_id'],3)
        self.api(rec,'PATCH',f'/api/patients/{second}',{'psychologist_id':other})
        self.api(rec,'GET','/api/stats',status=403)
        self.api(rec,'POST','/api/users',{'name':'bad'},status=403)
        day=(dt.date.today()-dt.timedelta(days=1)).isoformat()
        booking={'patient_ids':[pid],'psychologist_id':3,'room_id':1,'kind':'individual','start':day+'T09:00','end':day+'T10:00'}
        aid=self.api(rec,'POST','/api/appointments',booking)['id']
        self.api(psy,'GET',f'/api/shift-workspace?date={day}',status=403)
        self.api(director,'GET',f'/api/shift-workspace?date={day}',status=403)
        self.api(rec,'POST',f'/api/appointments/{aid}/arrival',{'patient_id':pid},status=409)
        today_booking={**booking,'start':dt.date.today().isoformat()+'T09:00','end':dt.date.today().isoformat()+'T10:00'}
        arrival_id=self.api(rec,'POST','/api/appointments',today_booking)['id']
        self.api(psy,'POST',f'/api/appointments/{arrival_id}/arrival',{'patient_id':pid})
        self.api('other','POST',f'/api/appointments/{arrival_id}/arrival',{'patient_id':pid},status=403)
        self.api(rec,'POST',f'/api/appointments/{arrival_id}/arrival',{'patient_id':second},status=404)
        self.api(rec,'POST',f'/api/appointments/{arrival_id}/arrival',{'patient_id':pid})
        arrival_rows=self.api(rec,'GET','/api/shift-workspace')
        arrived=next(x for x in arrival_rows if x['appointment_id']==arrival_id and x['patient_id']==pid)
        self.assertTrue(arrived['arrived_at'])
        self.api(rec,'POST',f'/api/appointments/{arrival_id}/start',{'patient_id':pid},status=403)
        self.api('other','POST',f'/api/appointments/{arrival_id}/start',{'patient_id':pid},status=404)
        first=self.api(psy,'POST',f'/api/appointments/{arrival_id}/start',{'patient_id':pid})
        self.assertTrue(first['started_at'])
        self.assertEqual(first['started_at'],self.api(psy,'POST',f'/api/appointments/{arrival_id}/start',{'patient_id':pid})['started_at'])
        self.assertEqual(first['started_at'],next(x for x in self.api(rec,'GET','/api/shift-workspace') if x['appointment_id']==arrival_id)['started_at'])
        self.api(rec,'GET','/api/admin/devices',status=403)
        self.api(psy,'POST','/api/mobile-status',{'version_code':34,'version_name':'3.2.0','pending_count':1,'blocked_count':0,'error_code':'pending'})
        self.assertFalse(self.api(admin,'GET','/api/shift-readiness')['ready'])
        report=next(d for d in self.api(admin,'GET','/api/admin/devices') if d['user_id']==3)
        self.assertEqual(report['pending_count'],1)
        self.assertTrue(report['fresh'])
        self.api(psy,'POST','/api/mobile-status',{'version_code':34,'version_name':'3.2.0','pending_count':0,'blocked_count':0,'error_code':''})
        self.api(director,'GET','/api/shift-readiness',status=403)
        self.api(rec,'POST',f'/api/patients/{pid}/progress',{},status=403)
        self.api(psy,'POST',f'/api/patients/{pid}/progress',{'goal':'Synthetic goal','status':'in_progress','observation':'Synthetic progress'})
        self.assertEqual(self.api(psy,'GET',f'/api/patients/{pid}/progress')[0]['goal'],'Synthetic goal')
        self.api(rec,'POST',f'/api/appointments/{arrival_id}/arrival',{'patient_id':pid})
        self.assertEqual(next(x for x in self.api(rec,'GET','/api/shift-workspace') if x['appointment_id']==arrival_id)['arrived_at'],arrived['arrived_at'])
        self.api(rec,'PATCH',f'/api/appointments/{arrival_id}',{'status':'cancelled'})
        self.api(rec,'POST',f'/api/appointments/{arrival_id}/arrival',{'patient_id':pid},status=409)
        self.api(rec,'POST','/api/appointments',booking,status=409)
        self.api(rec,'POST','/api/appointments',{**booking,'start':day+'T09:30','end':day+'T10:30'},status=409)
        self.api(psy,'POST','/api/appointments',booking,status=403)
        self.assertNotIn('09:00',self.api(rec,'GET',f'/api/slots?date={day}&psychologist_id=3&room_id=1'))
        self.assertEqual(self.api('other','GET','/api/appointments?date='+day),[])
        # Operational policy is authoritative across every client.
        defaults=self.api(admin,'GET','/api/settings/workflow')
        self.api(rec,'PATCH','/api/settings/workflow',{'session_hours':1},status=403)
        self.api(admin,'PATCH','/api/settings/workflow',{'opening_time':'19:00','closing_time':'09:00'},status=400)
        self.api(admin,'PATCH','/api/settings/workflow',{'session_hours':0},status=400)
        self.api(admin,'PATCH','/api/settings/workflow',{'working_days':'0'},status=400)
        self.api(admin,'PATCH','/api/settings/workflow',{'default_duration_minutes':241},status=400)
        self.api(admin,'PATCH','/api/settings/workflow',{'opening_time':'09:30','closing_time':'18:30','slot_step_minutes':15,'default_duration_minutes':45,'session_hours':2})
        slots=self.api(rec,'GET',f'/api/slots?date={day}&psychologist_id=3&room_id=1')
        self.assertEqual(slots[0],'10:00')
        self.assertIn('10:15',slots)
        self.assertEqual(slots[-1],'17:45')
        self.api(rec,'POST','/api/appointments',{**booking,'start':day+'T08:00','end':day+'T09:00'},status=400)
        self.api(admin,'PATCH','/api/settings/workflow',{'working_days':str(dt.date.today().isoweekday())})
        self.assertEqual(self.api(rec,'GET',f'/api/slots?date={day}&psychologist_id=3&room_id=1'),[])
        self.api(rec,'POST','/api/appointments',{**booking,'start':day+'T16:00','end':day+'T17:00'},status=400)
        self.assertTrue(all(x['expires'] <= time.time()+7201 for x in self.api(admin,'GET','/api/admin/sessions')))
        self.api(admin,'PATCH','/api/settings/workflow',defaults)

        note={'patient_id':pid,'appointment_id':aid,'note':'ПРИВАТНА НОТАТКА','goals':'Цілі','next_plan':'План','homework':'Завдання','consultation_type':'primary','duration_minutes':60,'request_text':'Запит','state_text':'Стан','work_done':'Робота','recommendations':'Рекомендації','result_text':'Результат','risk_level':'moderate','risk_flags':['sleep','anxiety']}
        self.api(rec,'POST','/api/consultations',note,status=403)
        self.api('other','POST','/api/consultations',note,status=403)
        self.api(psy,'POST','/api/consultations',note)
        self.api(psy,'POST','/api/consultations',note,status=403)
        detail=self.api(psy,'GET',f'/api/patients/{pid}')
        self.assertEqual(detail['consultations'][0]['note'],note['note'])
        result=self.api(rec,'GET',f'/api/patients/{pid}')
        self.assertNotIn('consultations',result)
        self.assertNotIn('ПРИВАТНА',json.dumps(result,ensure_ascii=False))
        admin_detail=self.api(admin,'GET',f'/api/patients/{pid}')
        self.assertEqual(admin_detail['patient_no'],created_patient['patient_no'])
        self.assertEqual(admin_detail['consultations'][0]['note'],note['note'])
        self.assertEqual(admin_detail['consultations'][0]['risk_level'],'moderate')
        self.api(admin,'PATCH','/api/settings/center',{'center_name':'Тестовий центр','short_name':'SOLVIA','address':'Адреса','phone':'123','email':'test@example.com','website':'','city':'Місто','director_name':'Директор','admin_name':'Адмін','work_hours':'08:00-20:00','document_footer':'Футер','discharge_signatory':'Психолог','head_name':'Завідувач Тест','head_title':'Завідувач центру','logo_data':'','appointment_reminder_minutes':30,'connection_mode':'local','local_api_url':'https://192.168.1.100:8443','vps_api_url':'https://solvia.example.test','vps_name':'QureMed VPS'})
        self.assertEqual(self.api(admin,'GET','/api/settings/center')['center_name'],'Тестовий центр')
        mobile_config=self.api(admin,'GET','/api/mobile-config')
        self.assertEqual(mobile_config['format'],'quremed.solvia.mobile')
        self.assertEqual(mobile_config['preferred'],'https')
        self.assertEqual(mobile_config['api_url'],'https://192.168.1.100:8443')
        self.assertNotIn('password',mobile_config)
        self.assertEqual(mobile_config['version'],2)
        health=self.call('GET','/api/health')[1]
        self.assertEqual(mobile_config['server_id'],health['server_id'])
        self.assertEqual(len(health['server_id']),64)
        self.api(admin,'GET','/api/mobile-config?stable=1',status=409)
        access=self.api(admin,'GET','/api/license')
        self.assertEqual(access['status'],'unmanaged')
        self.assertTrue(access['write_allowed'])
        self.api(rec,'POST','/api/license',{},status=403)
        self.api(rec,'GET','/api/mobile-config',status=403)
        self.api(psy,'GET','/api/mobile-config',status=403)
        center_settings=self.api(admin,'GET','/api/settings/center')
        self.assertEqual(center_settings['connection_mode'],'local')
        self.assertEqual(center_settings['local_api_url'],'https://192.168.1.100:8443')
        invalid_mobile=dict(center_settings,local_api_url='https://192.168.1.100:0')
        self.api(admin,'PATCH','/api/settings/center',invalid_mobile)
        self.api(admin,'GET','/api/mobile-config',status=400)
        self.api(admin,'PATCH','/api/settings/center',center_settings)
        self.assertEqual(center_settings['vps_api_url'],'https://solvia.example.test')
        bad_vps={**center_settings,'connection_mode':'vps','vps_api_url':'http://insecure.example.test'}
        bad_vps.pop('id',None); bad_vps.pop('updated',None)
        self.api(admin,'PATCH','/api/settings/center',bad_vps,status=400)
        good_vps={**center_settings,'connection_mode':'vps','vps_api_url':'https://solvia.example.test'}
        good_vps.pop('id',None); good_vps.pop('updated',None)
        self.api(admin,'PATCH','/api/settings/center',good_vps)
        self.assertEqual(self.api(admin,'GET','/api/settings/center')['connection_mode'],'vps')
        self.assertEqual(self.api(admin,'GET','/api/mobile-config?stable=1')['api_url'],'https://solvia.example.test')
        search=self.api(admin,'GET','/api/search?q='+urllib.parse.quote('Тестовий'))
        self.assertTrue(any(x['id']==pid for x in search['patients']))
        rid=self.api(admin,'POST','/api/rooms',{'name':'Тестова кімната','code':'T1','type':'family','capacity':4,'description':'Тест'})['id']
        self.api(admin,'PATCH',f'/api/rooms/{rid}',{'active':False})
        self.api(rec,'POST','/api/appointments',{**booking,'room_id':rid,'start':day+'T18:00','end':day+'T19:00'},status=400)
        self.api(admin,'DELETE',f'/api/rooms/{rid}',{})
        discharge=self.api(psy,'POST','/api/discharges',{'patient_id':pid,'date_from':day,'date_to':dt.date.today().isoformat(),'summary':'Підсумок','dynamics':'Динаміка','recommendations':'Рекомендації','followup':'Контроль'})
        self.assertEqual(discharge['patient']['id'],pid)
        self.assertTrue(discharge['document_no'])
        self.assertEqual(discharge['patient_name'],'Тестовий Пацієнт')
        self.assertEqual(discharge['patient_no_snapshot'],created_patient['patient_no'])
        self.assertEqual(discharge['psychologist_name'],'Psychologist')
        self.assertIn('проведено 1 консультацію',discharge['summary'])
        self.assertIn('Результат',discharge['dynamics'])
        discharge_detail=self.api(admin,'GET',f'/api/patients/{pid}')['discharges'][0]
        self.assertEqual(discharge_detail['psychologist'],'Psychologist')
        update={'revision':1,'summary':'Уточнений підсумок','dynamics':'Оновлена динаміка','recommendations':'Уточнені рекомендації','followup':'Подальший супровід','reason':'Уточнення документа'}
        discharge_path=f"/api/discharges/{discharge['id']}"
        self.api(rec,'PATCH',discharge_path,update,status=403)
        self.api('other','PATCH',discharge_path,update,status=403)
        self.api(director,'PATCH',discharge_path,{**update,'reason':''},status=400)
        revised=self.api(director,'PATCH',discharge_path,update)
        self.assertEqual(revised['revision'],2)
        self.assertEqual(revised['recommendations'],update['recommendations'])
        self.assertEqual(revised['document_no'],discharge['document_no'])
        self.api(admin,'PATCH',discharge_path,update,status=409)
        history=self.api(director,'GET',discharge_path+'/history')
        self.assertEqual(len(history),1)
        self.assertEqual(json.loads(history[0]['snapshot'])['summary'],discharge['summary'])
        self.api(rec,'GET',discharge_path+'/history',status=403)
        listed=self.api(director,'GET','/api/discharges')
        self.assertTrue(any(d['id']==discharge['id'] and d['revision']==2 for d in listed))


        admin_records=self.api(admin,'GET',f'/api/psychology-records?from={day}&to={day}')
        self.assertEqual(admin_records[0]['note'],note['note'])
        self.api(rec,'GET',f'/api/psychology-records?from={day}&to={day}',status=403)
        report={'shift_date':day,'summary':'Підсумок зміни','incidents':'Без критичних подій','handover':'Продовжити спостереження','critical_cases':False,'notify_admin':True,'notify_director':False}
        saved_report=self.api(psy,'POST','/api/shift-reports',report)
        self.assertEqual(saved_report['consultations_count'],1)
        reports=self.api(admin,'GET',f'/api/shift-reports?from={day}&to={day}')
        self.assertEqual(reports[0]['summary'],report['summary'])
        self.assertEqual(reports[0]['psychologist'],'Psychologist')
        self.api(rec,'GET',f'/api/shift-reports?from={day}&to={day}',status=403)

        patient_detail=self.api(admin,'GET',f'/api/patients/{pid}')
        self.assertEqual(patient_detail['referral_source'],'Військова частина')
        self.assertEqual(len(patient_detail['courses']),1)
        self.assertEqual(patient_detail['courses'][0]['status'],'active')

        document=self.api(rec,'POST',f'/api/patients/{pid}/documents',{
            'document_type':'informed_consent',
            'title':'Тестова інформована згода',
            'content':'Тестовий текст документа',
            'status':'signed',
            'signed_by_name':'Тестовий Пацієнт',
            'signature_data':'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jF0cAAAAASUVORK5CYII='
        })
        docs=self.api(rec,'GET',f'/api/patients/{pid}/documents')
        self.assertEqual(docs[0]['id'],document['id'])
        self.assertEqual(docs[0]['status'],'signed')
        self.assertEqual(docs[0]['patient_name'],'Тестовий Пацієнт')
        self.assertEqual(docs[0]['patient_no_snapshot'],created_patient['patient_no'])
        self.assertEqual(docs[0]['patient_dob'],p['dob'])
        self.assertEqual(docs[0]['patient_category'],p['category'])
        self.assertEqual(docs[0]['center_name_snapshot'],'Тестовий центр')
        self.assertEqual(docs[0]['center_email_snapshot'],'test@example.com')

        referral=self.api(rec,'POST',f'/api/patients/{pid}/referrals',{
            'destination_type':'Психіатр',
            'destination_name':'Тестовий спеціаліст',
            'reason':'Додаткова консультація'
        })
        self.api(rec,'PATCH',f"/api/referrals/{referral['id']}",{'status':'sent'})
        referrals=self.api(psy,'GET',f'/api/patients/{pid}/referrals')
        self.assertEqual(referrals[0]['status'],'sent')

        workload=self.api(admin,'GET','/api/workload')
        self.assertTrue(any(x['name']=='Psychologist' and x['active_patients'] >= 1 for x in workload['items']))
        self.api(rec,'GET','/api/workload',status=403)

        supervision=self.api(director,'POST','/api/supervisions',{
            'psychologist_id':3,
            'scheduled_at':dt.date.today().isoformat()+'T18:00',
            'duration_minutes':60,
            'topic':'Тестова супервізія'
        })
        self.api(psy,'PATCH',f"/api/supervisions/{supervision['id']}",{'case_summary':'Деідентифікований опис випадку'})
        self.api(director,'PATCH',f"/api/supervisions/{supervision['id']}",{
            'case_summary':'Деідентифікований опис випадку',
            'recommendations':'Рекомендації супервізора',
            'status':'completed'
        })
        supervisions=self.api(director,'GET','/api/supervisions')
        self.assertTrue(any(x['id']==supervision['id'] and x['status']=='completed' for x in supervisions))

        stats=self.api(director,'GET','/api/stats')
        self.assertEqual(stats['consultations'],1)
        self.assertEqual(stats['total_patients'],2)
        self.assertGreaterEqual(stats['active_courses'],2)
        # Object authorization must hold for ancillary endpoints too.
        for suffix in ('courses','documents','referrals'):
            self.api('other','GET',f'/api/patients/{pid}/{suffix}',status=403)
            self.api(director,'GET',f'/api/patients/{pid}/{suffix}',status=403)
        self.api('other','PATCH',f"/api/referrals/{referral['id']}",{'status':'completed'},status=403)
        self.api('other','PATCH',f"/api/supervisions/{supervision['id']}",{'case_summary':'attempt'},status=403)
        for endpoint in ('/api/admin/system','/api/admin/sessions','/api/audit','/api/users','/api/rooms'):
            for role in (rec,psy,director):self.api(role,'GET',endpoint,status=403)
        self.assertEqual(self.call('GET','/api/patients',token='0'*64)[0],401)
        self.api(rec,'POST',f'/api/patients/{pid}/documents',{
            'document_type':'informed_consent','title':'bad','content':'','status':'signed',
            'signed_by_name':'Test','signature_data':'data:image/png;base64,AAAA'},status=400)
        self.api(rec,'POST','/api/patients',{'name':'bad\x00hidden','phone':'+380501234567','dob':'1990-01-01','category':'Ветеран/ветеранка','psychologist_id':3},status=400)
        self.api(admin,'PATCH','/api/settings/workflow',{'session_hours':2**64-1},status=400)

        self.assertGreaterEqual(stats['signed_documents'],1)
        self.assertGreaterEqual(stats['outgoing_referrals'],1)
        self.assertGreaterEqual(stats['supervisions_completed'],1)
        self.assertNotIn('ПРИВАТНА',json.dumps(stats,ensure_ascii=False))
        self.api(rec,'PATCH',f'/api/appointments/{aid}',{'status':'cancelled'},status=409)
        link=self.api(psy,'POST','/api/assessments',{'patient_id':pid})['link']
        token=link.split('#')[1]
        self.api(None,'GET','/api/respond/'+token)
        self.api(None,'POST','/api/respond/'+token,{'answers':[1,20,3]},status=400)
        self.api(None,'POST','/api/respond/'+token,{'answers':[6,7,8]})
        self.api(None,'POST','/api/respond/'+token,{'answers':[6,7,8]},status=404)
        self.assertEqual(self.api(psy,'GET',f'/api/patients/{pid}')['assessments'][0]['score'],21)
        third=self.api(rec,'POST','/api/patients',{**p,'name':'Третій Пацієнт'})['id']
        group={**booking,'patient_ids':[pid,third],'kind':'group','start':day+'T11:00','end':day+'T12:00'}
        gid=self.api(rec,'POST','/api/appointments',group)['id']
        self.api(psy,'POST','/api/consultations',{**note,'appointment_id':gid})
        partial=[x for x in self.api(rec,'GET',f'/api/shift-workspace?date={day}') if x['appointment_id']==gid]
        self.assertEqual(len(partial),2)
        self.assertTrue(next(x for x in partial if x['patient_id']==pid)['completed_at'])
        self.assertFalse(next(x for x in partial if x['patient_id']==third)['completed_at'])
        self.assertNotIn('ПРИВАТНА',json.dumps(partial,ensure_ascii=False))
        self.assertNotIn('note',partial[0])
        self.api(rec,'PATCH',f'/api/appointments/{gid}',{'status':'cancelled'},status=409)
        self.api(psy,'POST','/api/consultations',{**note,'appointment_id':gid,'patient_id':third})
        status={x['id']:x['status'] for x in self.api(rec,'GET','/api/appointments?date='+day)}
        self.assertEqual(status[gid],'completed')
        excluded_group=self.api(rec,'POST','/api/appointments',{**group,'start':day+'T12:00','end':day+'T13:00'})['id']
        self.api(psy,'POST','/api/consultations',{**note,'appointment_id':excluded_group})
        self.api(rec,'PATCH',f'/api/appointments/{excluded_group}/attendance',{'patient_id':pid,'status':'no_show','reason':'Must not replace a completed record'},status=409)
        self.api(rec,'PATCH',f'/api/appointments/{excluded_group}/attendance',{'patient_id':third,'status':'no_show','reason':'Synthetic participant absent'})
        excluded_rows=[x for x in self.api(rec,'GET',f'/api/shift-workspace?date={day}') if x['appointment_id']==excluded_group]
        self.assertTrue(next(x for x in excluded_rows if x['patient_id']==pid)['completed_at'])
        self.assertEqual(next(x for x in excluded_rows if x['patient_id']==third)['visit_status'],'no_show')
        self.api(psy,'POST','/api/consultations',{**note,'appointment_id':excluded_group,'patient_id':third},status=403)
        move={**booking,'start':day+'T13:00','end':day+'T14:00'}
        mid=self.api(rec,'POST','/api/appointments',move)['id']
        self.api(rec,'PATCH',f'/api/appointments/{mid}',{**move,'start':day+'T14:00','end':day+'T15:00'})
        self.api(rec,'PATCH',f'/api/appointments/{mid}',{'status':'cancelled'})
        parallel_booking={**booking,'start':day+'T16:00','end':day+'T17:00'}
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
            results=list(pool.map(lambda _: self.call('POST','/api/appointments',parallel_booking,self.tokens[rec]),range(2)))
        self.assertEqual(sorted(x[0] for x in results),[200,409])
        current=self.api(admin,'GET',f'/api/patients/{pid}')
        active_course=next(x for x in current['courses'] if x['status']=='active')
        self.api(rec,'PATCH',f"/api/courses/{active_course['id']}",{
            'status':'archived',
            'ended_at':dt.date.today().isoformat(),
            'outcome':'Курс завершено'
        })
        archived=self.api(rec,'GET','/api/patients?status=archived')
        self.assertTrue(any(x['id']==pid for x in archived))
        new_course=self.api(rec,'POST',f'/api/patients/{pid}/courses',{
            'started_at':dt.date.today().isoformat(),
            'reason':'Повторне звернення'
        })
        self.assertGreater(new_course['course_no'],1)
        reopened=self.api(admin,'GET',f'/api/patients/{pid}')
        self.assertEqual(reopened['status'],'active')
        self.assertEqual(len(reopened['courses']),2)

        # Password reset and deactivation must revoke sessions permanently.
        code,old_login=self.call('POST','/api/login',{'login':'managed','password':'managed-test-password'})
        self.assertEqual(code,200,old_login)
        self.api(admin,'PATCH',f'/api/users/{managed}',{'password':'changed-test-password'})
        self.assertEqual(self.call('GET','/api/me',token=old_login['token'])[0],401)
        code,new_login=self.call('POST','/api/login',{'login':'managed','password':'changed-test-password'})
        self.assertEqual(code,200,new_login)
        self.api(admin,'PATCH',f'/api/users/{managed}',{'active':False})
        self.api(admin,'PATCH',f'/api/users/{managed}',{'active':True})
        self.assertEqual(self.call('GET','/api/me',token=new_login['token'])[0],401)
        # Staff can change their own password; old sessions are all revoked.
        code,account=self.call('POST','/api/login',{'login':'managed','password':'changed-test-password'})
        self.assertEqual(code,200,account)
        self.assertEqual(self.call('POST','/api/account/password',{'current_password':'wrong-password','new_password':'another-test-password'},account['token'])[0],403)
        self.assertEqual(self.call('POST','/api/account/password',{'current_password':'changed-test-password','new_password':''},account['token'])[0],400)
        self.assertEqual(self.call('POST','/api/account/password',{'current_password':'changed-test-password','new_password':'another-test-password'},account['token'])[0],200)
        self.assertEqual(self.call('GET','/api/me',token=account['token'])[0],401)
        code,account=self.call('POST','/api/login',{'login':'managed','password':'another-test-password'})
        self.assertEqual(code,200,account)


        self.api(admin,'DELETE',f'/api/users/{other}/sessions',{})
        self.api('other','GET','/api/me',status=401)
        records=self.api(admin,'GET',f'/api/patients/{pid}')['consultations']
        own=next(c for c in records if c['psychologist_id']==3)
        amendment={'reason':'Synthetic correction','content':'Additional observation','client_key':'synthetic-addendum-0001'}
        self.api(rec,'GET',f"/api/consultations/{own['id']}/addenda",status=403)
        self.api(admin,'POST',f"/api/consultations/{own['id']}/addenda",amendment,status=403)
        self.api(psy,'POST',f"/api/consultations/{own['id']}/addenda",amendment)
        self.assertTrue(self.api(psy,'POST',f"/api/consultations/{own['id']}/addenda",amendment)['already_saved'])
        self.api(psy,'POST',f"/api/consultations/{own['id']}/addenda",{**amendment,'content':'Different'},status=409)
        updated=next(c for c in self.api(admin,'GET',f'/api/patients/{pid}')['consultations'] if c['id']==own['id'])
        self.assertEqual(updated['note'],own['note'])
        self.assertEqual(len(updated['addenda']),1)
        self.api(psy,'POST','/api/mobile-status',{'version_code':34,'version_name':'3.2.0','pending_count':1,'blocked_count':0,'error_code':'pending'})
        readiness=self.api(admin,'GET','/api/shift-readiness')
        self.assertFalse(readiness['ready'])
        self.api(admin,'POST','/api/shift-day',{'action':'close'},status=409)
        for row in readiness['unfinished']:
            self.api(admin,'PATCH',f"/api/appointments/{row['appointment_id']}/attendance",{'patient_id':row['patient_id'],'status':'no_show','reason':'Synthetic shift cleanup'})
        for who in readiness['unknown_psychologists']:
            login='psychologist' if who['id']==3 else 'other'
            password=self.passwords['psychologist'] if who['id']==3 else 'long-test-password'
            previous=self.tokens.get(login)
            if previous and self.call('GET','/api/me',token=previous)[0]==200:
                account={'token':previous}
            else:
                code,account=self.call('POST','/api/login',{'login':login,'password':password,'device_id':f"ci-cleanup-{who['id']}",'device_name':'Synthetic'})
                self.assertEqual(code,200,account)
            code,info=self.call('POST','/api/mobile-status',{'version_code':34,'version_name':'3.2.0','pending_count':0,'blocked_count':0,'last_sync':'','error_code':''},account['token'])
            self.assertEqual(code,200,info)
        self.api(psy,'POST','/api/mobile-status',{'version_code':34,'version_name':'3.2.0','pending_count':1,'blocked_count':0,'error_code':'pending'})
        self.api(admin,'POST','/api/shift-day',{'action':'close'},status=409)
        self.api(psy,'POST','/api/mobile-status',{'version_code':34,'version_name':'3.2.0','pending_count':0,'blocked_count':0,'error_code':''})
        subprocess.run(['psql',self.database,'-X','-v','ON_ERROR_STOP=1','-c',"UPDATE mobile_devices SET last_seen_epoch=0 WHERE user_id=3"],check=True,stdout=subprocess.DEVNULL)
        self.assertFalse(self.api(admin,'GET','/api/shift-readiness')['ready'])
        self.api(psy,'POST','/api/mobile-status',{'version_code':34,'version_name':'3.2.0','pending_count':0,'blocked_count':0,'error_code':''})
        self.assertTrue(self.api(admin,'GET','/api/shift-readiness')['ready'])
        closed=self.api(admin,'POST','/api/shift-day',{'action':'close'})
        self.assertTrue(closed['sessions_terminated'])
        self.assertTrue(closed['backup_queued'])
        self.assertFalse(self.api(admin,'GET','/api/shift-day')['open'])
        self.api(psy,'GET','/api/me',status=401)
        self.api(rec,'GET','/api/me',status=401)
        self.api(director,'GET','/api/me',status=401)

        # Simulate both a pre-course patient and a date written by the initial 2.1 migration.
        subprocess.run(['psql',self.database,'-X','-v','ON_ERROR_STOP=1','-c',
            f"DELETE FROM patient_courses WHERE patient_id={third}; "
            f"UPDATE patient_courses SET started_at=started_at || 'T12:34:56' WHERE id={new_course['id']};"],
            check=True,stdout=subprocess.DEVNULL)
        # Restart: data persist, while closed-shift staff sessions remain terminated.
        self.proc.terminate(); self.proc.wait(timeout=10); self.start()
        admin_detail=self.api(admin,'GET',f'/api/patients/{pid}')
        self.assertEqual(len(admin_detail['consultations']),3)
        self.assertEqual(next(c for c in admin_detail['courses'] if c['id']==new_course['id'])['started_at'],dt.date.today().isoformat())
        migrated=self.api(admin,'GET',f'/api/patients/{third}')['courses'][0]
        self.assertEqual(migrated['started_at'],dt.date.today().isoformat())
        self.api(admin,'PATCH',f"/api/courses/{migrated['id']}",{'status':'completed','ended_at':dt.date.today().isoformat()})

        self.assertEqual(self.api(admin,'GET','/api/stats')['repeat_visits'],2)

        _,psy_auth=self.call('POST','/api/login',{'login':'psychologist','password':self.passwords['psychologist'],'platform':'Android','device_id':'ci-psych','device_name':'CI Tablet'})
        self.tokens[psy]=psy_auth['token']
        self.api(psy,'GET','/api/patients',status=423)
        self.api(admin,'POST','/api/shift-day',{'action':'open'})
        self.assertEqual(len(self.api(psy,'GET',f'/api/patients/{pid}')['consultations']),3)
        # Successful logins behind one reverse proxy must not exhaust the failure quota.
        self.api(psy,'POST','/api/logout',{})
        for _ in range(12):
            code,login=self.call('POST','/api/login',{'login':'psychologist','password':self.passwords['psychologist']})
            self.assertEqual(code,200,login)
            self.call('POST','/api/logout',{},login['token'])
        self.api(psy,'GET','/api/me',status=401)

    def test_features_drafts_waiting_list_and_retry(self):
        self.api('admin','POST','/api/shift-day',{'action':'open'})
        for name, role in [('draft_psy','psychologist'),('draft_other','psychologist'),('wait_rec','reception'),('wait_director','director')]:
            user=self.api('admin','POST','/api/users',{'name':name,'login':name,'password':'feature-password-2026','role':role})
            code, auth=self.call('POST','/api/login',{'login':name,'password':'feature-password-2026'})
            self.assertEqual(code,200,auth); self.tokens[name]=auth['token']
            if name=='draft_psy': psychologist=user['id']
        patient=self.api('wait_rec','POST','/api/patients',{'name':'Synthetic waiting patient','phone':'+380009991111','dob':'1995-02-01','category':'Інше','psychologist_id':psychologist})['id']
        path=f'/api/patients/{patient}/draft'
        self.assertEqual(self.api('draft_psy','GET',path)['version'],0)
        for role in ['admin','wait_rec','wait_director','draft_other']:
            self.api(role,'GET',path,status=403)
        payload={'note':'Private synthetic draft','goals':'Goal','appointment_id':'','client_key':'draft-test-client-key-2026'}
        saved=self.api('draft_psy','PATCH',path,{'version':0,'payload':payload})
        self.assertEqual(saved['version'],1)
        self.api('draft_psy','PATCH',path,{'version':0,'payload':{'note':'Stale overwrite'}},status=409)
        self.assertEqual(self.api('draft_psy','GET',path)['payload']['note'],payload['note'])
        self.api('draft_psy','PATCH',path,{'version':1,'payload':{'note':'x'*10001}},status=400)
        self.api('draft_psy','DELETE',path,{'version':0},status=409)
        self.api('draft_psy','DELETE',path,{'version':1})
        self.assertEqual(self.api('draft_psy','GET',path)['version'],2)
        self.assertIsNone(self.api('draft_psy','GET',path)['payload'])
        room=self.api('admin','POST','/api/rooms',{'name':'Waiting room','capacity':1})['id']
        self.api('admin','PATCH','/api/settings/workflow',{'opening_time':'09:00','closing_time':'18:00','working_days':'1234567'})
        date=(dt.date.today()-dt.timedelta(days=1)).isoformat()
        body={'patient_id':patient,'psychologist_id':psychologist,'date_from':date,'date_to':date,'time_from':'09:00','time_to':'18:00','priority':'normal','contact_note':'Call after 15:00'}
        wait=self.api('wait_rec','POST','/api/waiting-list',body)['id']
        self.api('wait_rec','POST','/api/waiting-list',body,status=409)
        for role in ['draft_psy','wait_director']:
            self.api(role,'GET','/api/waiting-list',status=403)
        self.api('wait_rec','PATCH',f'/api/waiting-list/{wait}',{'status':'offered','version':1})
        self.api('wait_rec','PATCH',f'/api/waiting-list/{wait}',{'status':'cancelled','version':1},status=409)
        booking={'version':2,'room_id':room,'start':date+'T09:00','end':date+'T10:00'}
        self.api('wait_rec','POST',f'/api/waiting-list/{wait}/book',{**booking,'start':date+'T08:00'},status=400)
        appointment=self.api('wait_rec','POST',f'/api/waiting-list/{wait}/book',booking)['id']
        repeat=self.api('wait_rec','POST',f'/api/waiting-list/{wait}/book',booking)
        self.assertEqual(repeat['id'],appointment);self.assertTrue(repeat['already_booked'])
        self.api('wait_rec','PATCH',f'/api/waiting-list/{wait}',{'status':'waiting','version':3},status=409)
        second=self.api('wait_rec','POST','/api/patients',{'name':'Second waiting patient','phone':'+380009991112','dob':'1995-02-01','category':'Інше','psychologist_id':psychologist})['id']
        otherwait=self.api('wait_rec','POST','/api/waiting-list',{**body,'patient_id':second})['id']
        self.api('wait_rec','POST',f'/api/waiting-list/{otherwait}/book',{**booking,'version':1},status=409)
        current=self.api('draft_psy','PATCH',path,{'version':2,'payload':payload})
        consultation={'patient_id':patient,'appointment_id':appointment,'note':'Completed synthetic consultation','client_key':payload['client_key'],'draft_version':current['version']}
        first=self.api('draft_psy','POST','/api/consultations',consultation)
        again=self.api('draft_psy','POST','/api/consultations',consultation)
        self.assertEqual(first['id'],again['id']);self.assertTrue(again['already_saved'])
        self.api('draft_psy','POST','/api/consultations',{**consultation,'note':'Changed after a lost response'},status=409)
        self.assertIsNone(self.api('draft_psy','GET',path)['payload'])
        self.assertEqual(len(self.api('draft_psy','GET',f'/api/patients/{patient}')['consultations']),1)

    def prepare_synthetic_shift_close(self, day):
        # Earlier scenarios leave completed appointments for psychologists without
        # a current mobile heartbeat. Give this isolated fixture an empty queue.
        subprocess.check_call(['psql',self.database,'-v','ON_ERROR_STOP=1','-c',f"""
            UPDATE appointments SET status='no_show' WHERE substr(start,1,10)='{day}' AND status IN ('scheduled','confirmed');
            UPDATE mobile_devices SET pending_count=0,blocked_count=0,last_seen_epoch=extract(epoch from now())::bigint;
            INSERT INTO mobile_devices(user_id,device_id,device_name,version_code,version_name,last_seen,pending_count,blocked_count,last_seen_epoch)
            SELECT DISTINCT psychologist_id,'synthetic-close-{day}','Synthetic close',37,'3.3.0','{day}T12:00:00',0,0,extract(epoch from now())::bigint
            FROM appointments WHERE substr(start,1,10)='{day}'
            ON CONFLICT(user_id,device_id) DO UPDATE SET last_seen=EXCLUDED.last_seen,last_seen_epoch=EXCLUDED.last_seen_epoch,pending_count=0,blocked_count=0;
        """])
        self.assertTrue(self.api('admin','GET','/api/shift-readiness')['ready'])

    def test_x2_shift_binding_survives_midnight_until_explicit_close(self):
        self.api('admin','POST','/api/shift-day',{'action':'open'})
        yesterday=(dt.date.today()-dt.timedelta(days=1)).isoformat()
        subprocess.check_call(['psql',self.database,'-v','ON_ERROR_STOP=1','-c',f"DELETE FROM shift_days WHERE shift_date='{yesterday}'; UPDATE shift_days SET shift_date='{yesterday}' WHERE shift_date=current_date::text;"])
        self.api('admin','POST','/api/users',{'name':'Нічний Психолог','login':'нічний_психолог','password':'3','role':'psychologist'})
        code,auth=self.call('POST','/api/login',{'login':'нічний_психолог','password':'3','platform':'Android','device_id':'night-shift-phone'})
        self.assertEqual(code,200,auth);self.assertTrue(auth['user']['shift_bound']);self.assertEqual(auth['user']['shift_date'],yesterday)
        code,shift=self.call('GET','/api/shift-day',token=auth['token']);self.assertEqual(code,200);self.assertEqual(shift['shift_date'],yesterday)
        self.prepare_synthetic_shift_close(yesterday)
        self.api('admin','POST','/api/shift-day',{'action':'close'})
        self.assertEqual(self.call('GET','/api/me',token=auth['token'])[0],401)
        self.api('admin','POST','/api/shift-day',{'action':'open'})

    def test_x_shift_device_binding_short_ukrainian_login_and_profile(self):
        self.api('admin','POST','/api/shift-day',{'action':'open'})
        first=self.api('admin','POST','/api/users',{'name':'Психолог Перший По батькові','login':'психолог_перший','password':'1','role':'psychologist'})['id']
        second=self.api('admin','POST','/api/users',{'name':'Психолог Другий','login':'психолог_другий','password':'2','role':'psychologist'})['id']
        def login(name,password):
            return self.call('POST','/api/login',{'login':name,'password':password,'platform':'Android','device_id':'bound-shift-phone','device_name':'Shift phone'})
        code,first_auth=login('психолог_перший','1');self.assertEqual(code,200,first_auth)
        user=first_auth['user'];self.assertTrue(user['shift_bound']);self.assertRegex(user['staff_number'],r'^\d{4}$')
        self.assertEqual(login('психолог_другий','2')[0],409)
        token=first_auth['token'];self.assertEqual(self.call('GET','/api/me',token=token)[0],200)
        subprocess.check_call(['psql',self.database,'-v','ON_ERROR_STOP=1','-c',f"UPDATE sessions SET expires=0 WHERE token='{hashlib.sha256(token.encode()).hexdigest()}'"])
        self.assertEqual(self.call('GET','/api/me',token=token)[0],200)
        self.call('POST','/api/logout',{},token)
        self.assertEqual(login('психолог_другий','2')[0],409)
        code,again=login('психолог_перший','1');self.assertEqual(code,200)
        self.assertEqual(again['user']['staff_number'],user['staff_number'])
        center=self.api('admin','GET','/api/settings/center');center['server_name']='Додатковий'
        self.api('admin','PATCH','/api/settings/center',center)
        self.assertEqual(self.call('GET','/api/me',token=again['token'])[1]['server_name'],'Додатковий')
        # Synthetic installation: complete readiness so the real close endpoint can run.
        self.prepare_synthetic_shift_close(dt.date.today().isoformat())
        self.api('admin','POST','/api/shift-day',{'action':'close'})
        self.assertEqual(self.call('GET','/api/me',token=again['token'])[0],401)
        self.api('admin','POST','/api/shift-day',{'action':'open'})
        self.assertEqual(login('психолог_другий','2')[0],200)

    def test_y_staff_message_device_scope_and_receipts(self):
        def login(role, device):
            if self.tokens.get(role): self.call('POST','/api/logout',{},self.tokens[role])
            code, auth = self.call('POST','/api/login',{'login':role,'password':self.passwords[role],'platform':'Android','device_id':device,'device_name':device})
            self.assertEqual(code,200,auth)
            self.tokens[role]=auth['token']
            return auth['token'], auth['user']['id']
        admin,_=login('admin','staff-desktop')
        psy,uid=login('psychologist','staff-phone')
        denied,_=self.call('POST','/api/login',{'login':'psychologist','password':self.passwords['psychologist'],'platform':'Android','device_id':'staff-other-phone'})
        self.assertEqual(denied,409)
        rec,_=login('reception','staff-reception')
        def call(token,method,path,body=None,status=200):
            code,result=self.call(method,path,body,token)
            self.assertEqual(code,status,result)
            return result
        call(psy,'POST','/api/mobile-status',{'version_code':34,'version_name':'test','pending_count':0,'blocked_count':0,'last_sync':'','error_code':''})
        people=call(admin,'GET','/api/staff/recipients')
        call(rec,'GET','/api/staff/recipients',status=403)
        call(rec,'GET','/api/staff/messages',status=403)
        self.assertTrue(any(p['id']==uid and any(d['device_id']=='staff-phone' for d in p['devices']) for p in people))
        call(psy,'GET','/api/staff/recipients',status=403)
        payload={'recipient_id':uid,'device_id':'staff-phone','body':'Службове тестове повідомлення','client_key':'staff-test-message'}
        call(psy,'POST','/api/staff/messages',payload,status=403)
        call(rec,'POST','/api/staff/messages',payload,status=403)
        director,_=login('director','staff-director')
        call(director,'POST','/api/staff/messages',{**payload,'client_key':'director-message'})
        call(admin,'POST','/api/staff/messages',{**payload,'device_id':'unknown-phone'},status=400)
        message=call(admin,'POST','/api/staff/messages',payload)
        again=call(admin,'POST','/api/staff/messages',payload)
        self.assertEqual(message['id'],again['id'])
        call(admin,'POST','/api/staff/messages',{**payload,'body':'Змінений текст'},status=409)
        self.assertTrue(any(m['id']==message['id'] for m in call(psy,'GET','/api/staff/messages')))
        path=f"/api/staff/messages/{message['id']}"
        call(rec,'POST',path+'/read',{},status=403)
        call(psy,'POST',path+'/delivered',{})
        sent=next(m for m in call(admin,'GET','/api/staff/messages') if m['id']==message['id'])
        self.assertIsNotNone(sent['delivered_at']); self.assertIsNone(sent['read_at'])
        call(psy,'POST',path+'/read',{})
        read=next(m for m in call(admin,'GET','/api/staff/messages') if m['id']==message['id'])
        self.assertIsNotNone(read['read_at'])
        call(psy,'POST',path+'/read',{})
        call(psy,'POST','/api/logout',{})
        second,_=login('psychologist','staff-other-phone')
        self.assertFalse(any(m['id']==message['id'] for m in call(second,'GET','/api/staff/messages')))
        call(second,'POST',path+'/read',{},status=404)
        call(admin,'POST','/api/staff/messages',{**payload,'device_id':'','client_key':'staff-all-phones'})
        self.assertTrue(any(m['client_key']=='staff-all-phones' for m in call(second,'GET','/api/staff/messages')))

    def test_z_security_inputs_and_rate_limit(self):
        # Authentication checks work even if a browser or forged caller bypasses UI.
        for login in ("' OR '1'='1",'admin\x00extra'):
            status,_=self.call('POST','/api/login',{'login':login,'password':'invalid-password'})
            self.assertIn(status,(400,401))
        req=urllib.request.Request(self.base+'/api/health')
        with urllib.request.urlopen(req) as r:
            self.assertEqual(r.headers['X-Frame-Options'],'DENY')
            self.assertEqual(r.headers['X-Content-Type-Options'],'nosniff')
            self.assertIn("object-src 'none'",r.headers['Content-Security-Policy'])
        for _ in range(12):
            code,_=self.call('POST','/api/login',{'login':'missing-account','password':'invalid-password'})
            if code==429:break
            self.assertEqual(code,401)
        self.assertEqual(code,429)
        self.assertEqual(self.call('GET','/api/me',token='forged-token')[0],401)

    def test_z_40_concurrent_staff_write_and_retry(self):
        """40 separate accounts book, arrive, start, save and retry real HTTP writes."""
        self.api('admin','POST','/api/shift-day',{'action':'open'})
        today=dt.date.today().isoformat();previous=(dt.date.today()-dt.timedelta(days=1)).isoformat()
        # Synthetic-only installation; no production credentials or clinical data.
        staff=[]
        for i in range(40):
            login=f'load-{i}'
            uid=self.api('admin','POST','/api/users',{'name':f'Synthetic load {i}','login':login,'password':'synthetic-load-password','role':'psychologist'})['id']
            room=self.api('admin','POST','/api/rooms',{'name':f'Synthetic load room {i}','code':f'LOAD{i}','type':'individual','capacity':1,'description':'CI only'})['id']
            pid=self.api('admin','POST','/api/patients',{'name':f'Synthetic load patient {i}','phone':f'+38000888{i:04d}','dob':'1990-01-01','category':'Інше','psychologist_id':uid})['id']
            code,account=self.call('POST','/api/login',{'login':login,'password':'synthetic-load-password','device_id':f'load-device-{i}','device_name':'Synthetic load','platform':'Android'})
            self.assertEqual(code,200,account)
            staff.append((i,uid,room,pid,account['token']))
        durations=[]
        def worker(item):
            i,uid,room,pid,token=item
            def call(method,path,body=None):
                began=time.monotonic();code,result=self.call(method,path,body,token);durations.append(time.monotonic()-began)
                if code!=200:raise AssertionError((i,method,path,code,result))
                return result
            def book(date):
                began=time.monotonic();code,data=self.call('POST','/api/appointments',{'patient_ids':[pid],'psychologist_id':uid,'room_id':room,'kind':'individual','start':date+'T09:00','end':date+'T10:00'},self.tokens['admin']);durations.append(time.monotonic()-began)
                if code!=200:raise AssertionError((i,code,data))
                return data['id']
            current=book(today);old=book(previous)
            call('POST',f'/api/appointments/{current}/arrival',{'patient_id':pid})
            call('POST',f'/api/appointments/{current}/start',{'patient_id':pid})
            appointments=call('GET','/api/appointments?date='+today)
            if any(a['psychologist_id']!=uid for a in appointments):raise AssertionError('Cross-account schedule leak')
            payload={'patient_id':pid,'appointment_id':old,'note':'Synthetic completed load consultation','client_key':f'synthetic-load-key-{i:04d}'}
            saved=call('POST','/api/consultations',payload)
            retry=call('POST','/api/consultations',payload)
            if retry['id']!=saved['id'] or not retry['already_saved']:raise AssertionError('Duplicate consultation after retry')
            history=call('GET',f'/api/patients/{pid}')['consultations']
            if len(history)!=1:raise AssertionError('Lost or duplicated clinical record')
            call('POST','/api/mobile-status',{'version_code':34,'version_name':'3.2.0','pending_count':0,'blocked_count':0,'last_sync':'','error_code':''})
            return current,uid
        began=time.monotonic()
        with concurrent.futures.ThreadPoolExecutor(max_workers=40) as pool:
            finished=list(pool.map(worker,staff))
        elapsed=time.monotonic()-began;ordered=sorted(durations);p95=ordered[int(len(ordered)*.95)-1]
        print(f'LOAD40: {len(staff)} accounts, {len(durations)} requests, errors=0, duplicated=0, p95={p95:.3f}s, max={max(durations):.3f}s, elapsed={elapsed:.3f}s',flush=True)
        self.assertLess(p95,10,'40-user p95 response time exceeds 10 seconds')
        devices=self.api('admin','GET','/api/admin/devices')
        self.assertEqual(sum(d['device_id'].startswith('load-device-') for d in devices),40)
        for aid,uid in finished:
            # Do not leave synthetic active visits influencing later shift checks.
            self.api('admin','PATCH',f'/api/appointments/{aid}',{'status':'cancelled','cancellation_reason':'Synthetic load completed'})
            self.api('admin','PATCH',f'/api/users/{uid}',{'active':False})

    def test_recovery_mobile_preserves_text_versions_authorship_and_duplicates(self):
        self.api('admin','POST','/api/shift-day',{'action':'open'})
        self.api('admin','PATCH','/api/settings/workflow',{'opening_time':'08:00','closing_time':'20:00','working_days':'1234567'})
        suffix=str(time.time_ns());password='Recovery-password-2026'
        uid=self.api('admin','POST','/api/users',{'name':'Recovery psychologist','login':'recover_'+suffix,'password':password,'role':'psychologist'})['id']
        code,login=self.call('POST','/api/login',{'login':'recover_'+suffix,'password':password,'platform':'CI-Recovery','device_id':'recovery-phone','device_name':'Recovery phone'})
        self.assertEqual(code,200,login);self.tokens['recovery_psy']=login['token']
        patient=self.api('admin','POST','/api/patients',{'name':'Recovery patient','phone':'+380000000099','dob':'1990-01-01','category':'Інше','psychologist_id':uid})['id']
        room=self.api('admin','POST','/api/rooms',{'name':'Recovery room','capacity':2})['id']
        day=(dt.date.today()-dt.timedelta(days=1)).isoformat()
        def booking(hour,date=day):
            return self.api('admin','POST','/api/appointments',{'psychologist_id':uid,'room_id':room,'start':f'{date}T{hour:02}:00','end':f'{date}T{hour+1:02}:00','kind':'individual','patient_ids':[patient]})['id']
        aid=booking(10)
        payload={'patient_id':patient,'appointment_id':aid,'client_key':'recovery-original-'+suffix,'note':'Original phone text','duration_minutes':60,'consultation_type':'repeat','risk_level':'low','risk_flags':[]}
        upload={'items':[{'kind':'consultation','payload':payload,'error':'Draft conflict'}]}
        forbidden={}
        for role in ['reception','director','psychologist']:
            login_name='recover_'+role+'_'+suffix
            self.api('admin','POST','/api/users',{'name':'Recovery forbidden '+role,'login':login_name,'password':password,'role':role})
            code,auth=self.call('POST','/api/login',{'login':login_name,'password':password,'platform':'CI-Recovery','device_id':'recovery-forbidden-'+role})
            self.assertEqual(code,200,auth)
            account='recovery_forbidden_'+role;self.tokens[account]=auth['token'];forbidden[role]=account
            self.api(account,'GET','/api/admin/recovery',status=403)
        self.api('recovery_psy','GET','/api/admin/recovery',status=403)
        self.api('admin','POST','/api/mobile-recovery',upload,status=403)
        self.api(forbidden['psychologist'],'POST','/api/mobile-recovery',upload,status=403)
        self.api('recovery_psy','POST','/api/mobile-recovery',{'items':[upload['items'][0]]*6},status=400)
        self.api('recovery_psy','POST','/api/mobile-recovery',{'items':[{'kind':'draft','payload':{**payload,'note':{}},'error':''}]},status=400)
        self.api('recovery_psy','POST','/api/mobile-recovery',upload)
        listing=self.api('admin','GET',f'/api/admin/recovery?user_id={uid}&device_id=recovery-phone')
        self.assertEqual(len(listing),1);rid=listing[0]['id'];path=f'/api/admin/recovery/{rid}'
        detail=self.api('admin','GET',path);self.assertEqual(detail['payload']['note'],'Original phone text')
        edited={**payload,'note':'Newer phone snapshot'}
        self.api('recovery_psy','POST','/api/mobile-recovery',{'items':[{'kind':'consultation','payload':edited,'error':'Draft conflict'}]})
        completion={'action':'complete','revision':1,'draft_version':0,'payload':edited,'reason':'Checked with psychologist','confirmed':True}
        self.api('admin','POST',path,completion,status=409)
        detail=self.api('admin','GET',path);self.assertEqual(detail['revision'],2)
        self.api('recovery_psy','PATCH',f'/api/patients/{patient}/draft',{'version':0,'payload':{**edited,'note':'Different server text'}})
        completion.update(revision=2)
        self.api('admin','POST',path,completion,status=409)
        completion['draft_version']=1
        self.api('admin','POST',path,completion,status=409)
        completion.update(confirm_server_conflict=True,payload={**edited,'note':'Approved after review'})
        self.api('recovery_psy','POST',path,completion,status=403)
        self.api('admin','POST',path,{**completion,'payload':{**completion['payload'],'patient_id':patient+99999}},status=400)
        done=self.api('admin','POST',path,completion)['consultation_id']
        self.api('admin','POST',path,completion,status=409)
        record=next(c for c in self.api('admin','GET',f'/api/patients/{patient}')['consultations'] if c['id']==done)
        self.assertEqual(record['psychologist_id'],uid);self.assertEqual(record['note'],'Approved after review')
        detail=self.api('admin','GET',path)
        self.assertEqual(detail['payload']['note'],'Newer phone snapshot')
        self.assertEqual(json.loads(detail['server_snapshot'])['payload']['note'],'Different server text')
        self.assertEqual(detail['state'],'completed');self.assertEqual(detail['resolved_by'],1)
        ack=self.api('recovery_psy','POST','/api/mobile-recovery',{'items':[{'kind':'consultation','payload':edited,'error':'Draft conflict'}]})['items'][0]
        self.assertEqual(ack['consultation_id'],done);self.assertEqual(ack['source']['note'],'Newer phone snapshot')
        self.assertEqual(len(self.api('recovery_psy','GET',f'/api/patients/{patient}')['consultations']),1)
        self.assertIsNone(self.api('recovery_psy','GET',f'/api/patients/{patient}/draft')['payload'])
        # A lost response is linked to the existing consultation without editing it.
        second=booking(11);p2={**payload,'appointment_id':second,'client_key':'recovery-second-'+suffix,'note':'Already saved text'}
        cid=self.api('recovery_psy','POST','/api/consultations',p2)['id']
        self.api('recovery_psy','POST','/api/mobile-recovery',{'items':[{'kind':'consultation','payload':{**p2,'note':'Different local text'},'error':'Already saved'}]})
        r2=next(r for r in self.api('admin','GET',f'/api/admin/recovery?user_id={uid}') if r['appointment_id']==second)
        d2=self.api('admin','GET',f'/api/admin/recovery/{r2["id"]}')
        link={'action':'link','revision':r2['revision'],'draft_version':d2['draft_version'],'reason':'Compared both copies','confirmed':True,'consultation_id':done}
        self.api('admin','POST',f'/api/admin/recovery/{r2["id"]}',link,status=409)
        self.api('admin','POST',f'/api/admin/recovery/{r2["id"]}',{**link,'consultation_id':cid})
        self.assertEqual(len(self.api('admin','GET',f'/api/patients/{patient}')['consultations']),2)
        self.assertEqual(next(c for c in self.api('admin','GET',f'/api/patients/{patient}')['consultations'] if c['id']==cid)['note'],'Already saved text')
        # A mistaken no-show is restored explicitly, and invalid text rolls restoration back.
        third=booking(12);p3={**payload,'appointment_id':third,'client_key':'recovery-third-'+suffix}
        self.api('admin','PATCH',f'/api/appointments/{third}/attendance',{'patient_id':patient,'status':'no_show','reason':'Synthetic mistake'})
        self.api('recovery_psy','POST','/api/mobile-recovery',{'items':[{'kind':'draft','payload':p3,'error':'No available appointment'}]})
        r3=next(r for r in self.api('admin','GET',f'/api/admin/recovery?user_id={uid}') if r['appointment_id']==third)
        d3=self.api('admin','GET',f'/api/admin/recovery/{r3["id"]}')
        body={'action':'complete','revision':r3['revision'],'draft_version':d3['draft_version'],'payload':p3,'reason':'Corrected mistaken no-show','confirmed':True}
        self.api('admin','POST',f'/api/admin/recovery/{r3["id"]}',body,status=409)
        self.api('admin','POST',f'/api/admin/recovery/{r3["id"]}',{**body,'restore_attendance':True,'payload':{**p3,'note':''}},status=400)
        appointment=next(a for a in self.api('admin','GET',f'/api/appointments?date={day}') if a['id']==third)
        self.assertEqual(appointment['status'],'no_show')
        self.api('admin','POST',f'/api/admin/recovery/{r3["id"]}',{**body,'restore_attendance':True})
        # Completing an older blocked visit must not erase a newer, different appointment's draft.
        fourth=booking(13);p4={**payload,'appointment_id':fourth,'client_key':'recovery-fourth-'+suffix}
        different={**payload,'appointment_id':aid,'client_key':'unrelated-new-draft-'+suffix,'note':'Unrelated newer draft'}
        draft_version=self.api('recovery_psy','GET',f'/api/patients/{patient}/draft')['version']
        new_draft=self.api('recovery_psy','PATCH',f'/api/patients/{patient}/draft',{'version':draft_version,'payload':different})
        self.api('recovery_psy','POST','/api/mobile-recovery',{'items':[{'kind':'consultation','payload':p4,'error':'Offline'}]})
        r4=next(r for r in self.api('admin','GET',f'/api/admin/recovery?user_id={uid}') if r['appointment_id']==fourth)
        self.api('admin','POST',f'/api/admin/recovery/{r4["id"]}',{'action':'complete','revision':r4['revision'],'draft_version':new_draft['version'],'payload':p4,'reason':'Older visit verified','confirmed':True})
        self.assertEqual(self.api('recovery_psy','GET',f'/api/patients/{patient}/draft')['payload']['note'],'Unrelated newer draft')
        # Restore only the excluded participant of an already closed group.
        participant=self.api('admin','POST','/api/patients',{'name':'Recovery group participant','phone':'+380000000098','dob':'1991-01-01','category':'Інше','psychologist_id':uid})['id']
        group=self.api('admin','POST','/api/appointments',{'psychologist_id':uid,'room_id':room,'start':day+'T14:00','end':day+'T15:00','kind':'group','patient_ids':[patient,participant]})['id']
        first_group={**payload,'appointment_id':group,'client_key':'recovery-group-first-'+suffix}
        first_id=self.api('recovery_psy','POST','/api/consultations',first_group)['id']
        self.api('admin','PATCH',f'/api/appointments/{group}/attendance',{'patient_id':participant,'status':'no_show','reason':'Mistaken group absence'})
        group_source={**payload,'appointment_id':group,'patient_id':participant,'client_key':'recovery-group-second-'+suffix}
        self.api('recovery_psy','POST','/api/mobile-recovery',{'items':[{'kind':'consultation','payload':group_source,'error':'Group already closed'}]})
        rg=next(r for r in self.api('admin','GET',f'/api/admin/recovery?user_id={uid}') if r['appointment_id']==group)
        self.api('admin','POST',f'/api/admin/recovery/{rg["id"]}',{'action':'complete','revision':rg['revision'],'draft_version':0,'payload':group_source,'reason':'Group attendance verified','confirmed':True,'restore_attendance':True})
        group_saved=next(a for a in self.api('admin','GET',f'/api/appointments?date={day}') if a['id']==group)
        self.assertEqual(group_saved['status'],'completed')
        self.assertEqual(next(c for c in self.api('admin','GET',f'/api/patients/{patient}')['consultations'] if c['id']==first_id)['note'],first_group['note'])
        # Never conduct a future appointment through recovery.
        future=booking(13,(dt.date.today()+dt.timedelta(days=1)).isoformat());pf={**payload,'appointment_id':future,'client_key':'recovery-future-'+suffix}
        self.api('recovery_psy','POST','/api/mobile-recovery',{'items':[{'kind':'consultation','payload':pf,'error':'Future'}]})
        rf=next(r for r in self.api('admin','GET',f'/api/admin/recovery?user_id={uid}') if r['appointment_id']==future)
        df=self.api('admin','GET',f'/api/admin/recovery/{rf["id"]}')
        self.api('admin','POST',f'/api/admin/recovery/{rf["id"]}',{'action':'complete','revision':rf['revision'],'draft_version':df['draft_version'],'payload':pf,'reason':'Attempt','confirmed':True},status=409)
        # Clean synthetic future fixture so it cannot influence later shift checks.
        self.api('admin','PATCH',f'/api/appointments/{future}',{'status':'cancelled','cancellation_reason':'Recovery test complete'})

    def test_z_rehabilitation_goal_workflow(self):
        """Only assigned psychologists can edit; history and revisions are preserved."""
        self.api('admin','POST','/api/shift-day',{'action':'open'})
        psychologist=self.api('psychologist','GET','/api/me')['id']
        patient=self.api('admin','POST','/api/patients',{
            'name':'Synthetic Rehabilitation Patient','phone':'+380000009771',
            'dob':'1993-06-01','category':'Інше','psychologist_id':psychologist
        })['id']
        endpoint=f'/api/patients/{patient}/rehab-goals'
        self.assertEqual(self.api('psychologist','GET',endpoint),[])
        self.api('reception','GET',endpoint,status=403)
        self.api('director','GET',endpoint,status=403)
        self.api('admin','POST',endpoint,{'title':'Forbidden administration entry'},status=403)
        created=self.api('psychologist','POST',endpoint,{
            'title':'Restore daily activities','measurement':'Functional interview',
            'baseline':'Needs support','target_value':'Independent daily routine',
            'target_date':(dt.date.today()+dt.timedelta(days=30)).isoformat()
        })
        goal_id=created['id']
        result=self.api('psychologist','GET',endpoint)
        self.assertEqual(len(result),1)
        self.assertEqual(result[0]['title'],'Restore daily activities')
        self.assertEqual(result[0]['revision'],1)
        self.assertEqual(len(result[0]['updates']),1)
        self.assertEqual(len(self.api('admin','GET',endpoint)),1)
        # Access remains scoped to the currently assigned psychologist.
        self.api('admin','POST','/api/users',{
            'name':'Rehab outsider','login':'rehab-outsider-ci',
            'password':'synthetic-test','role':'psychologist'
        })
        code,session=self.call('POST','/api/login',{
            'login':'rehab-outsider-ci','password':'synthetic-test','platform':'CI'
        })
        self.assertEqual(code,200,session)
        self.assertEqual(self.call('GET',endpoint,token=session['token'])[0],403)
        self.assertEqual(self.call('PATCH',f'/api/rehab-goals/{goal_id}',{
            'revision':1,'state':'achieved','note':'Unauthorized','progress_value':'Ready'
        },session['token'])[0],403)
        self.api('psychologist','PATCH',f'/api/rehab-goals/{goal_id}',{
            'revision':1,'state':'in_progress','progress_value':'Improving',
            'note':'Weekly specialist review'
        })
        self.api('psychologist','PATCH',f'/api/rehab-goals/{goal_id}',{
            'revision':1,'state':'achieved','progress_value':'Completed',
            'note':'Stale update'
        },status=409)
        updated=self.api('psychologist','GET',endpoint)[0]
        self.assertEqual(updated['revision'],2)
        self.assertEqual(updated['updates'][0]['note'],'Weekly specialist review')
        self.assertEqual(len(updated['updates']),2)
        course=self.api('admin','GET',f'/api/patients/{patient}')['courses'][0]
        self.api('admin','PATCH',f'/api/courses/{course["id"]}',{
            'status':'completed','ended_at':dt.date.today().isoformat(),'outcome':'Test ended'
        })
        self.api('psychologist','PATCH',f'/api/rehab-goals/{goal_id}',{
            'revision':2,'state':'achieved','progress_value':'Completed','note':'After course'
        },status=409)
        self.assertEqual(len(self.api('admin','GET',endpoint)),1)

    def test_zz_centre_document_templates(self):
        """The administrator owns templates; inactive forms disappear from staff lists."""
        created=self.api('admin','POST','/api/document-templates',{
            'title':'Synthetic rehab consent',
            'content':'Patient {{patient_name}}, record {{patient_no}}, date {{today}}'
        })
        endpoint=f'/api/document-templates/{created["id"]}'
        self.assertTrue(any(t['id']==created['id'] for t in self.api('psychologist','GET','/api/document-templates')))
        self.api('reception','POST','/api/document-templates',{
            'title':'Unauthorized','content':'Should not save'
        },status=403)
        self.api('psychologist','PATCH',endpoint,{'active':False},status=403)
        self.api('admin','PATCH',endpoint,{'active':False})
        self.assertFalse(any(t['id']==created['id'] for t in self.api('psychologist','GET','/api/document-templates')))
        self.assertTrue(any(t['id']==created['id'] for t in self.api('admin','GET','/api/document-templates')))
        self.api('admin','PATCH',endpoint,{'title':'Updated synthetic consent','content':'Final reviewed form','active':True})
        self.assertTrue(any(t['title']=='Updated synthetic consent' for t in self.api('reception','GET','/api/document-templates')))

    def test_y_lean_workday_home_authorization(self):
        """Home needs one request and never leaks clinical notes."""
        self.api('admin','POST','/api/shift-day',{'action':'open'})
        # Earlier shift-close tests correctly terminate staff sessions.
        # Recreate synthetic sessions before checking cross-role permissions.
        staff=self.api('admin','GET','/api/users')
        for role in ('reception','psychologist','director'):
            uid=next(x['id'] for x in staff if x['login']==role)
            self.api('admin','DELETE',f'/api/users/{uid}/sessions',{})
            code,auth=self.call('POST','/api/login',{
                'login':role,'password':self.passwords[role],
                'platform':'CI-workday','device_id':'ci-workday-'+role
            })
            self.assertEqual(code,200,auth)
            self.tokens[role]=auth['token']
        for role in ('admin','reception'):
            result=self.api(role,'GET','/api/workday/home')
            self.assertEqual(result['date'],dt.date.today().isoformat())
            self.assertIn('waiting',result['counts'])
            self.assertIn('arrived',result['counts'])
            self.assertIn('completed',result['counts'])
            self.assertIn('active_patients',result)
            self.assertIn('waiting_list',result)
            self.assertIsInstance(result['next'],list)
            self.assertLessEqual(len(result['next']),6)
            for item in result['next']:
                self.assertTrue(set(item).issubset({'appointment_id','start','end','patient_id','patient','patient_no','psychologist','room','arrived_at'}))
            self.assertNotIn('consultations',result)
            self.assertNotIn('risk_flags',result)
        self.api('psychologist','GET','/api/workday/home',status=403)
        self.api('director','GET','/api/workday/home',status=403)

    def test_z_patient_directory_search_and_summary_counts(self):
        """Real SQL pagination, literal searches, role scope and dashboard totals."""
        def sql(statement):
            return subprocess.check_output(['psql',self.database,'-X','-qAt','-v','ON_ERROR_STOP=1','-c',statement],text=True).strip()
        psy=self.api('psychologist','GET','/api/me')['id']
        admin=self.api('admin','GET','/api/me')['id']
        marker='DirectorySynthetic'
        ids=[]
        try:
            for i in range(28):
                ids.append(int(sql(f"INSERT INTO patients(name,phone,dob,category,psychologist_id,created,admin_note) VALUES('{marker} {i:02d}','+380 (50) 123-45-67','1990-01-01','Інше',{psy},'2026-01-01T00:00','PRIVATE_DIRECTORY_NOTE') RETURNING id")))
            endpoint='/api/patient-directory?q='+marker
            first=self.api('reception','GET',endpoint)
            second=self.api('reception','GET',endpoint+'&page=2')
            self.assertEqual(first['total'],28)
            self.assertEqual(len(first['items']),25)
            self.assertEqual(len(second['items']),3)
            self.assertFalse(set(p['id'] for p in first['items']) & set(p['id'] for p in second['items']))
            self.assertEqual([p['id'] for p in first['items']+second['items']],list(reversed(ids)))
            self.assertNotIn('PRIVATE_DIRECTORY_NOTE',json.dumps(first))
            own=self.api('psychologist','GET',endpoint)
            self.assertEqual(own['total'],28)
            sql(f"UPDATE patients SET psychologist_id={admin} WHERE id={ids[0]}")
            self.assertEqual(self.api('psychologist','GET',endpoint)['total'],27)
            self.assertEqual(self.api('admin','GET',endpoint)['total'],28)
            phone=self.api('admin','GET','/api/patient-directory?q=0501234567&page_size=100')
            self.assertTrue(set(ids).issubset({p['id'] for p in phone['items']}))
            sql(f"UPDATE patients SET name='DirectoryLiteral % _' WHERE id={ids[1]}")
            literal=self.api('reception','GET','/api/patient-directory?q='+urllib.parse.quote('% _'))
            self.assertEqual([p['id'] for p in literal['items']],[ids[1]])
            for query in ('page=0','page=-1','page=99999999999999999999','page_size=101','status=invalid','q='+('x'*301)):
                self.api('admin','GET','/api/patient-directory?'+query,status=400)
            self.api('director','GET','/api/patient-directory',status=403)
            self.assertEqual(self.call('GET','/api/patient-directory')[0],401)
            sql(f"UPDATE patients SET status='archived' WHERE id={ids[2]}")
            archive=self.api('admin','GET',endpoint+'&status=archived')
            self.assertEqual([p['id'] for p in archive['items']],[ids[2]])
            day=dt.date.today().isoformat()
            for pid,state in zip(ids[3:7],('waiting','offered','booked','cancelled')):
                sql(f"INSERT INTO waiting_list(patient_id,psychologist_id,date_from,date_to,status,created_by,created,updated) VALUES({pid},{psy},'{day}','{day}','{state}',{admin},'{day}','{day}')")
            summary=self.api('admin','GET','/api/workday/home')
            self.assertEqual(summary['active_patients'],int(sql("SELECT count(*) FROM patients WHERE status='active'")))
            self.assertEqual(summary['waiting_list'],int(sql("SELECT count(*) FROM waiting_list WHERE status IN ('waiting','offered')")))
        finally:
            if ids:
                listing=','.join(map(str,ids))
                sql(f'DELETE FROM waiting_list WHERE patient_id IN ({listing}); DELETE FROM patients WHERE id IN ({listing})')

    def test_zy_admin_host_diagnostics_are_role_restricted(self):
        system=self.api('admin','GET','/api/admin/system')
        self.assertIn('host_resources',system)
        self.assertIn('api_timing',system)
        self.assertGreaterEqual(system['api_timing']['successful_requests'],0)
        self.assertGreaterEqual(system['api_timing']['max_wait_ms'],0)
        self.api('reception','GET','/api/admin/system',status=403)
        self.api('psychologist','GET','/api/admin/system',status=403)
    def test_zx_operational_handover_and_linux_telemetry(self):
        """Handover survives retries and forbids access to unrelated roles."""
        system=self.api('admin','GET','/api/admin/system')
        self.assertIn('host_resources',system)
        self.assertGreaterEqual(system['api_timing']['successful_requests'],0)
        self.assertGreaterEqual(system['api_timing']['max_wait_ms'],0)
        resources=system['host_resources']
        self.assertIn(resources['platform'],('linux','windows','other'))
        if resources.get('disk_available'):
            self.assertGreater(resources['disk_total_bytes'],0)
            self.assertLessEqual(resources['disk_free_bytes'],resources['disk_total_bytes'])
        self.api('reception','GET','/api/admin/system',status=403)
        self.api('admin','POST','/api/shift-day',{'action':'open'})
        day=dt.date.today().isoformat()
        self.api('admin','POST','/api/reception-access',{'access_date':day,'start_time':'00:00','enabled':True})
        key='ci-handover-'+str(time.time_ns())
        draft={'summary':'Перевірити доступність кабінету після зміни','priority':'important','client_key':key}
        created=self.api('reception','POST','/api/operations/handover',draft)
        self.assertFalse(created['replayed'])
        replay=self.api('reception','POST','/api/operations/handover',draft)
        self.assertEqual(replay['id'],created['id'])
        self.assertTrue(replay['replayed'])
        self.api('reception','POST','/api/operations/handover',{**draft,'priority':'urgent'},status=409)
        records=self.api('admin','GET','/api/operations/handover')
        self.assertTrue(any(row['id']==created['id'] and row['state']=='open' for row in records))
        for role in ('psychologist','director'):
            self.api(role,'GET','/api/operations/handover',status=403)
            self.api(role,'POST','/api/operations/handover',draft,status=403)
        self.api('admin','PATCH',f'/api/operations/handover/{created["id"]}',{'state':'resolved'})
        self.api('admin','PATCH',f'/api/operations/handover/{created["id"]}',{'state':'resolved'},status=409)
        records=self.api('reception','GET','/api/operations/handover')
        self.assertTrue(any(row['id']==created['id'] and row['state']=='resolved' for row in records))

    def test_zz_service_maintenance_and_durable_shift_backup(self):
        status=self.call('GET','/api/client-status')[1]
        self.assertEqual(status['mode'],'ready')
        self.assertNotIn('backups',status)
        self.api('admin','POST','/api/shift-day',{'action':'open'})
        state=self.api('admin','POST','/api/admin/service-state',{'mode':'maintenance','message':'Synthetic update','expected_until':int(time.time())+120})
        self.assertEqual(state['mode'],'maintenance')
        try:
            public=self.call('GET','/api/client-status')[1]
            self.assertEqual(public['message'],'Synthetic update')
            self.assertGreater(public['expected_until'],public['server_time'])
            self.api('admin','POST','/api/rooms',{'name':'Must not write during maintenance'},status=503)
            self.api('admin','GET','/api/patient-directory')
            self.api('reception','POST','/api/admin/service-state',{'mode':'ready'},status=403)
            self.api('admin','POST','/api/admin/service-state',{'mode':'wrong'},status=400)
        finally:
            self.api('admin','POST','/api/admin/service-state',{'mode':'ready'})
        self.assertEqual(self.call('GET','/api/client-status')[1]['mode'],'ready')
        # A prior full workflow closes a real shift; the backup queue must survive restart.
        rows=subprocess.check_output(['psql',self.database,'-X','-qAt','-c','SELECT count(*) FROM shift_backup_jobs'],text=True)
        self.assertGreater(int(rows),0)

if __name__=='__main__': unittest.main()
