"""Exercise the real C++ HTTP server and PostgreSQL database, with synthetic data."""
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
            code, body = cls.call('POST', '/api/login', {'login':role, 'password':password, 'platform':'CI-'+role})
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
        shift=self.api(admin,'GET','/api/shift-day')
        self.assertFalse(shift['open'])
        shift=self.api(admin,'POST','/api/shift-day',{'action':'open'})
        self.assertTrue(shift['open'])
        other=self.api(admin,'POST','/api/users',{'name':'Інший психолог','login':'other','phone':'+380501112233','password':'long-test-password','role':'psychologist'})['id']
        _,auth=self.call('POST','/api/login',{'login':'other','password':'long-test-password','platform':'Android'})
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
        center_settings=self.api(admin,'GET','/api/settings/center')
        self.assertEqual(center_settings['connection_mode'],'local')
        self.assertEqual(center_settings['local_api_url'],'https://192.168.1.100:8443')
        self.assertEqual(center_settings['vps_api_url'],'https://solvia.example.test')
        bad_vps={**center_settings,'connection_mode':'vps','vps_api_url':'http://insecure.example.test'}
        bad_vps.pop('id',None); bad_vps.pop('updated',None)
        self.api(admin,'PATCH','/api/settings/center',bad_vps,status=400)
        good_vps={**center_settings,'connection_mode':'vps','vps_api_url':'https://solvia.example.test'}
        good_vps.pop('id',None); good_vps.pop('updated',None)
        self.api(admin,'PATCH','/api/settings/center',good_vps)
        self.assertEqual(self.api(admin,'GET','/api/settings/center')['connection_mode'],'vps')
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
        self.api(rec,'PATCH',f'/api/appointments/{gid}',{'status':'cancelled'},status=409)
        self.api(psy,'POST','/api/consultations',{**note,'appointment_id':gid,'patient_id':third})
        status={x['id']:x['status'] for x in self.api(rec,'GET','/api/appointments?date='+day)}
        self.assertEqual(status[gid],'completed')
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
        self.assertEqual(self.call('POST','/api/account/password',{'current_password':'changed-test-password','new_password':'short'},account['token'])[0],400)
        self.assertEqual(self.call('POST','/api/account/password',{'current_password':'changed-test-password','new_password':'another-test-password'},account['token'])[0],200)
        self.assertEqual(self.call('GET','/api/me',token=account['token'])[0],401)
        code,account=self.call('POST','/api/login',{'login':'managed','password':'another-test-password'})
        self.assertEqual(code,200,account)


        self.api(admin,'DELETE',f'/api/users/{other}/sessions',{})
        self.api('other','GET','/api/me',status=401)
        closed=self.api(admin,'POST','/api/shift-day',{'action':'close'})
        self.assertTrue(closed['sessions_terminated'])
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
        self.assertEqual(len(admin_detail['consultations']),2)
        self.assertEqual(next(c for c in admin_detail['courses'] if c['id']==new_course['id'])['started_at'],dt.date.today().isoformat())
        migrated=self.api(admin,'GET',f'/api/patients/{third}')['courses'][0]
        self.assertEqual(migrated['started_at'],dt.date.today().isoformat())
        self.api(admin,'PATCH',f"/api/courses/{migrated['id']}",{'status':'completed','ended_at':dt.date.today().isoformat()})

        self.assertEqual(self.api(admin,'GET','/api/stats')['repeat_visits'],1)

        _,psy_auth=self.call('POST','/api/login',{'login':'psychologist','password':self.passwords['psychologist'],'platform':'Android','device_id':'ci-psych','device_name':'CI Tablet'})
        self.tokens[psy]=psy_auth['token']
        self.api(psy,'GET','/api/patients',status=423)
        self.api(admin,'POST','/api/shift-day',{'action':'open'})
        self.assertEqual(len(self.api(psy,'GET',f'/api/patients/{pid}')['consultations']),2)
        # Successful logins behind one reverse proxy must not exhaust the failure quota.
        for _ in range(12):
            code,login=self.call('POST','/api/login',{'login':'psychologist','password':self.passwords['psychologist']})
            self.assertEqual(code,200,login)
            self.call('POST','/api/logout',{},login['token'])
        self.api(psy,'POST','/api/logout',{})
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

if __name__=='__main__': unittest.main()
