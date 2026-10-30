import React from 'react';

export function ViewSwitch({value,onChange}) {
  return <div className="directory-view-switch" role="group" aria-label="Вигляд списку">
    <button type="button" aria-pressed={value==='table'} onClick={()=>onChange('table')}>Таблиця</button>
    <button type="button" aria-pressed={value==='cards'} onClick={()=>onChange('cards')}>Картки</button>
  </div>;
}
export default function PatientDirectory({rows,view,onOpen,onBook,archived=false,familyContext=false}) {
  if(view==='table')return <div className="workspace-table-scroll"><table className="workspace-table patient-directory-table">
    <thead><tr><th>Пацієнт</th><th>Телефон</th><th>Категорія</th><th>Психолог</th>{familyContext&&<><th>Роль у сім’ї</th><th>Курс</th></>}<th>Дії</th></tr></thead>
    <tbody>{rows.map(p=><tr key={p.id}>
      <td><button className="directory-patient-name" onClick={()=>onOpen(p.id)}>{p.name}</button><small>№ {p.patient_no || '—'}{p.family?` · ${p.family}`:''}</small></td>
      <td>{p.phone || '—'}</td><td><span className="directory-category">{p.category || '—'}</span></td><td>{p.psychologist || 'Не призначено'}</td>{familyContext&&<><td>{p.family_role||'Не вказано'}</td><td>{({active:'Активний',archived:'В архіві',completed:'Завершений'})[p.status]||p.status}</td></>}
      <td><div className="directory-row-actions"><button className="button secondary" onClick={()=>onOpen(p.id)}>Картка</button>{onBook&&!archived&&<button className="button primary" onClick={()=>onBook({patientId:p.id})}>Записати</button>}</div></td>
    </tr>)}</tbody>
  </table></div>;
  return <div className="patient-card-list">{rows.map(p=><div className="patient-entry" key={p.id}>
    <button className="patient-list-card" onClick={()=>onOpen(p.id)}>
      <span className="patient-card-accent"/>
      <span className="patient-card-head"><span className="avatar patient-avatar">{p.name.slice(0,1).toUpperCase()}</span><span className="patient-card-name"><small>{archived?'АРХІВ':'ПАЦІЄНТ'} · №{p.patient_no || '—'}</small><strong>{p.name}</strong><span>{p.phone || 'Телефон не вказано'}</span></span><span className="patient-card-arrow">↗</span></span>
      <span className="patient-card-tags"><span className="directory-category">{p.category}</span></span>
      <span className="patient-card-meta"><span><small>ПСИХОЛОГ</small><strong>{p.psychologist || 'Не призначено'}</strong></span><span><small>СІМ’Я</small><strong>{p.family || 'Без сімейного зв’язку'}</strong></span></span>
    </button>
    {onBook&&!archived&&<div className="patient-entry-actions"><button className="button secondary" onClick={()=>onBook({patientId:p.id})}>Записати на консультацію</button></div>}
  </div>)}</div>;
}
