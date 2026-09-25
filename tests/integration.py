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
        p={'name':'Тестовий Пацієнт','phone':'+380000000000','dob':'1990-01-01','category':'Ветеран/ветеранка','psychologist_id':3,'family_id':family,'family_role':'Військовий'}
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
        stats=self.api(director,'GET','/api/stats')
        self.assertEqual(stats['consultations'],1)
        self.assertEqual(stats['total_patients'],2)
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
        self.api(admin,'DELETE',f'/api/users/{other}/sessions',{})
        self.api('other','GET','/api/me',status=401)
        closed=self.api(admin,'POST','/api/shift-day',{'action':'close'})
        self.assertTrue(closed['sessions_terminated'])
        self.assertFalse(self.api(admin,'GET','/api/shift-day')['open'])
        self.api(psy,'GET','/api/me',status=401)
        self.api(rec,'GET','/api/me',status=401)
        self.api(director,'GET','/api/me',status=401)

        # Restart: data persist, while closed-shift staff sessions remain terminated.
        self.proc.terminate(); self.proc.wait(timeout=10); self.start()
        admin_detail=self.api(admin,'GET',f'/api/patients/{pid}')
        self.assertEqual(len(admin_detail['consultations']),2)
        self.assertEqual(self.api(admin,'GET','/api/stats')['repeat_visits'],1)

        _,psy_auth=self.call('POST','/api/login',{'login':'psychologist','password':self.passwords['psychologist'],'platform':'Android','device_id':'ci-psych','device_name':'CI Tablet'})
        self.tokens[psy]=psy_auth['token']
        self.api(psy,'GET','/api/patients',status=423)
        self.api(admin,'POST','/api/shift-day',{'action':'open'})
        self.assertEqual(len(self.api(psy,'GET',f'/api/patients/{pid}')['consultations']),2)
        self.api(psy,'POST','/api/logout',{})
        self.api(psy,'GET','/api/me',status=401)

if __name__=='__main__': unittest.main()
