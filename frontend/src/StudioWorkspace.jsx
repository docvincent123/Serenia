import React from 'react';
import AppIcon from './AppIcon.jsx';

// Tabs navigate existing role-scoped workspaces; no duplicate data or editor UI.
export default function StudioWorkspace({navigation,role,page,locked,onNavigate}){
 const active=page==='patient-card'?'patients':page;
 const keys=role==='admin'?['dashboard','shift-workspace','patients','calendar','team','reports']:
  role==='reception'?['reception-home','shift-workspace','patients','calendar','waiting-list']:
  role==='director'?['dashboard','workload','supervisions','discharges']:['calendar','patients','reports','supervisions'];
 const labels={dashboard:'Головна','reception-home':'Головна','shift-workspace':'Прийоми',patients:'Пацієнти',calendar:'Календар',team:'Команда',reports:'Звіти'};
 const allowed=new Map(navigation);
 const shown=keys.filter(key=>allowed.has(key));
 if(allowed.has(active)&&!shown.includes(active))shown.push(active);
 return <div className="studio-chrome">
  <header className="studio-header">
   <div className="studio-identity"><span className="studio-wordmark">SOLVIA<span aria-hidden="true">✦</span></span><span className="studio-header-divider"/><span className="studio-center-label">Робочий простір центру</span></div>
   <div className="studio-header-actions"><span className="studio-staff-name">{role==='admin'?'Адміністратор':role==='reception'?'Реєстратура':role==='director'?'Керівник':'Психолог'}</span><button className="studio-directory-button" disabled={locked} onClick={()=>onNavigate('module-directory')}><AppIcon name="module-directory" size={15}/>Усі розділи</button></div>
  </header>
  <nav className="studio-tabs" aria-label="Вкладки робочого простору">{shown.map(key=><button type="button" key={key} className={active===key?'active':''} aria-current={active===key?'page':undefined} aria-label={`Відкрити вкладку ${labels[key]||allowed.get(key)}`} disabled={locked&&key!=='preferences'&&key!=='staff-messages'} onClick={()=>onNavigate(key)}>{labels[key]||allowed.get(key)}</button>)}</nav>
 </div>;
}
