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

BINARY = str(pathlib.Path(sys.argv.pop(1)).resolve())

class Scenario(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.database = os.environ.get('SOLVIA_TEST_DATABASE_URL', '')
        if not cls.database:
            raise RuntimeError('SOLVIA_TEST_DATABASE_URL is required')
        output = subprocess.check_output([BINARY, '--database', cls.database, '--demo'], text=True, encoding='utf-8')
        cls.passwords = dict(line.split(': ', 1) for line in output.splitlines() if ': ' in line)
        with socket.socket() as s:
            s.bind(('127.0.0.1', 0)); cls.port = s.getsockname()[1]
        cls.base = f'http://127.0.0.1:{cls.port}'
        cls.start()
        cls.tokens = {}
        for role, password in cls.passwords.items():
            code, body = cls.call('POST', '/api/login', {'login':role, 'password':password})
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
        other=self.api(admin,'POST','/api/users',{'name':'Інший психолог','login':'other','password':'long-test-password','role':'psychologist'})['id']
        _,auth=self.call('POST','/api/login',{'login':'other','password':'long-test-password'})
        self.tokens['other']=auth['token']
        family=self.api(rec,'POST','/api/families',{'name':'Тестова сім’я'})['id']
        p={'name':'Тестовий Пацієнт','phone':'+380000000000','dob':'1990-01-01','category':'Ветеран/ветеранка','psychologist_id':3,'family_id':family,'family_role':'Військовий'}
        pid=self.api(rec,'POST','/api/patients',p)['id']
        self.api(rec,'POST','/api/patients',p,status=409)
        self.api(rec,'POST','/api/patients',{**p,'name':'Invalid date','dob':'2026-02-30'},status=400)
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
        note={'patient_id':pid,'appointment_id':aid,'note':'ПРИВАТНА НОТАТКА','goals':'Цілі','next_plan':'План','homework':'Завдання'}
        self.api(rec,'POST','/api/consultations',note,status=403)
        self.api('other','POST','/api/consultations',note,status=403)
        self.api(psy,'POST','/api/consultations',note)
        self.api(psy,'POST','/api/consultations',note,status=403)
        detail=self.api(psy,'GET',f'/api/patients/{pid}')
        self.assertEqual(detail['consultations'][0]['note'],note['note'])
        for role in (rec,admin):
            result=self.api(role,'GET',f'/api/patients/{pid}')
            self.assertNotIn('consultations',result)
            self.assertNotIn('ПРИВАТНА',json.dumps(result,ensure_ascii=False))
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
        # Restart: the patient, notes, questionnaires and active sessions persist.
        self.proc.terminate(); self.proc.wait(timeout=10); self.start()
        self.assertEqual(len(self.api(psy,'GET',f'/api/patients/{pid}')['consultations']),2)
        self.assertEqual(self.api(director,'GET','/api/stats')['repeat_visits'],1)
        self.api(psy,'POST','/api/logout',{})
        self.api(psy,'GET','/api/me',status=401)

if __name__=='__main__': unittest.main()
