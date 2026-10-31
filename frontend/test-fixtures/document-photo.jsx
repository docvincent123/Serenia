import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import DocumentPhoto from '../src/DocumentPhoto.jsx';
import ShiftWorkspace from '../src/ShiftWorkspace.jsx';
import '../src/styles.css';
import '../src/desk.css';
const day=new Date().toISOString().slice(0,10);
const base={appointment_id:1,patient_id:1,start:day+'T10:00',end:day+'T11:00',patient:'Тестовий Пацієнт',patient_no:'00001',psychologist:'Тестовий Психолог',psychologist_id:3,room:'Кабінет 1',kind:'individual',status:'scheduled'};
let rows=[base,{...base,appointment_id:2,patient_id:2,patient:'Пацієнт Очікує',arrived_at:new Date(Date.now()-1200000).toISOString()},{...base,appointment_id:3,patient_id:3,patient:'Пацієнт Консультація',started_at:day+'T09:50'},{...base,appointment_id:4,patient_id:4,patient:'Пацієнт Завершено',completed_at:day+'T10:30'}];
window.calls=[];
const api=async(method,path,body)=>{window.calls.push({method,path,body});if(method==='POST'&&path.endsWith('/arrival'))rows=rows.map(r=>r.patient_id===body.patient_id?{...r,arrived_at:new Date().toISOString()}:r);return rows;};
function Harness(){const [form,setForm]=useState({source:'paper_scan',content:''}),[error,setError]=useState('');return <main style={{padding:24}}><DocumentPhoto value={form} onChange={setForm} onError={setError}/><textarea aria-label="Розпізнаний текст" value={form.content} onChange={e=>setForm({...form,content:e.target.value})}/><pre id="error">{error}</pre><output id="scan-state">{JSON.stringify({paper_signed:form.paper_signed,scan:!!form.scan_data,original:!!form.original_data})}</output><ShiftWorkspace api={api} shift={{shift_date:day}} openPatient={()=>{}} openCalendar={()=>{}} onBook={()=>{}} onCreatePatient={()=>{}}/></main>}
createRoot(document.getElementById('root')).render(<Harness/>);
