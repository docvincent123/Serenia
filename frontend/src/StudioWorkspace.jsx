import React from 'react';

// The top header and the navigation tabs are deliberately separate:
// the active shift status sits between them.
export default function StudioWorkspace({navigation,role,page,locked,onNavigate,section='all',headerTools=null}){
 const active=page==='patient-card'?'patients':page;
 const keys=role==='admin'?['dashboard','shift-workspace','patients','calendar','team','reports']:
  role==='reception'?['reception-home','shift-workspace','patients','calendar','waiting-list']:
  role==='director'?['dashboard','workload','supervisions','discharges']:['calendar','patients','reports','supervisions'];
 const labels={dashboard:'Головна','reception-home':'Головна','shift-workspace':'Прийоми',patients:'Пацієнти',calendar:'Календар',team:'Команда',reports:'Звіти'};
 const allowed=new Map(navigation);
 const shown=keys.filter(key=>allowed.has(key));
 if(allowed.has(active)&&!shown.includes(active))shown.push(active);
 return <div className={`studio-chrome studio-chrome-${section}`}>
  {section!=='tabs'&&<header className="studio-header">
   <div className="studio-identity"><span className="studio-wordmark">SOLVIA<span aria-hidden="true">✦</span></span><span className="studio-header-divider"/><span className="studio-center-label">Робочий простір центру</span></div>
   <div className="studio-header-tools">{headerTools}</div>
  </header>}
  {section!=='header'&&<nav className="studio-tabs" aria-label="Вкладки робочого простору">{shown.map(key=><button type="button" key={key} className={active===key?'active':''} aria-current={active===key?'page':undefined} aria-label={`Відкрити вкладку ${labels[key]||allowed.get(key)}`} disabled={locked&&key!=='preferences'&&key!=='staff-messages'} onClick={()=>onNavigate(key)}>{labels[key]||allowed.get(key)}</button>)}</nav>}
 </div>;
}
