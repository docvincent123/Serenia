export function addMinutes(time,duration){
  if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)||!Number.isInteger(Number(duration))||Number(duration)<=0)return '';
  const [h,m]=time.split(':').map(Number),end=h*60+m+Number(duration);
  if(end>=1440)return '';
  return `${String(Math.floor(end/60)).padStart(2,'0')}:${String(end%60).padStart(2,'0')}`;
}
export function matchesPatient(patient,query){
  const q=query.trim().toLocaleLowerCase('uk');
  return !q||[patient.name,patient.patient_no,patient.phone].some(value=>String(value||'').toLocaleLowerCase('uk').includes(q))||(/\d/.test(q)&&/^\+?[\d\s()-]+$/.test(q)&&String(patient.phone||'').replace(/\D/g,'').includes(q.replace(/\D/g,'')));
}
export function bookingProblem(form,workflow={}){
  if(!form.patient_ids?.length)return 'Оберіть пацієнта.';
  if(!form.psychologist_id||!form.room_id)return 'Оберіть психолога та кабінет.';
  if(!/^\d{4}-\d{2}-\d{2}$/.test(form.date||'')||Number.isNaN(new Date(`${form.date}T12:00:00`).getTime()))return 'Оберіть дату консультації.';
  const parsed=new Date(`${form.date}T12:00:00`);
  if(`${parsed.getFullYear()}-${String(parsed.getMonth()+1).padStart(2,'0')}-${String(parsed.getDate()).padStart(2,'0')}`!==form.date)return 'Некоректна дата консультації.';
  if(!Number.isInteger(Number(form.duration))||form.duration<15||form.duration>240)return 'Тривалість прийому має бути від 15 до 240 хвилин.';
  const end=addMinutes(form.start,form.duration);
  if(!end)return 'Перевірте час: прийом має завершитися в межах одного дня.';
  if(form.start<(workflow.opening_time||'08:00')||end>(workflow.closing_time||'20:00'))return `Прийом має бути в межах годин роботи: ${workflow.opening_time||'08:00'}–${workflow.closing_time||'20:00'}.`;
  if(workflow.working_days){const day=new Date(`${form.date}T12:00:00`).getDay()||7;if(!workflow.working_days.includes(String(day)))return 'На обрану дату центр не працює. Оберіть робочий день.';}
  return '';
}
