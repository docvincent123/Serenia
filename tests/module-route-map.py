"""Compile the real server classifier and guard every native module's route family."""
from pathlib import Path
import json
import subprocess
import tempfile
source=Path('src/server/main.cpp').read_text()
start=source.index('std::string moduleForApi(')
end=source.index('\n}',start)+2
cases={
 '/api/patients/1':'patients','/api/patient-directory':'patients','/api/families':'patients',
 '/api/patients/1/documents':'documents','/api/document-templates':'documents','/api/discharges/1/workflow':'documents',
 '/api/patients/1/draft':'clinical','/api/consultations/1/addenda':'clinical',
 '/api/patients/1/rehab-goals':'rehabilitation','/api/rehab-goals/1':'rehabilitation',
 '/api/patients/1/referrals':'rehabilitation','/api/referrals/1':'rehabilitation','/api/courses/1':'rehabilitation',
 '/api/patients/1/appointments':'appointments','/api/operations/handover':'appointments','/api/tv/call':'appointments',
 '/api/tv/candidates':'appointments','/api/waiting-list/1/book':'appointments','/api/slots':'appointments',
 '/api/staff/messages':'messages','/api/staff/recipients':'messages',
 '/api/supervisions':'reports','/api/shift-reports':'reports','/api/stats':'reports',
 '/api/shift-psychologists':'roster','/api/account/password':'','/api/admin/devices':''
}
checks='\n'.join('if(moduleForApi('+json.dumps(route)+')!='+json.dumps(module)+')return '+str(i+1)+';' for i,(route,module) in enumerate(cases.items()))
with tempfile.TemporaryDirectory() as temp:
 cpp=Path(temp)/'routes.cpp';exe=Path(temp)/'routes'
 cpp.write_text('#include <string>\n'+source[start:end]+'\nint main(){'+checks+'}')
 subprocess.run(['g++','-std=c++20',str(cpp),'-o',str(exe)],check=True)
 subprocess.run([str(exe)],check=True)
print(f'PASS: {len(cases)} real server module routes, including nested patient routes')
