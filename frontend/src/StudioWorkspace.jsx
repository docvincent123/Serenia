import React from 'react';

// Single orientation bar: current task, live network status, search and alerts.
// No duplicate top-level tabs; every role keeps its existing permission-scoped navigation.
export default function StudioWorkspace({headerTools=null,currentPage='Огляд',roleLabel='',staffName='',online=true}){
 const initials=staffName.trim().slice(0,1).toLocaleUpperCase('uk')||'S';
 return <div className="studio-chrome studio-chrome-header">
  <header className="studio-header">
   <div className="studio-identity">
    <img className="studio-mark" src="/solvia-icon.png" alt="" aria-hidden="true"/>
    <span className="studio-wordmark">SOLVIA</span>
    <span className="studio-header-divider"/>
    <div className="solvia-header-location"><span>РОБОЧИЙ ПРОСТІР</span><strong>{currentPage}</strong></div>
   </div>
   <div className="studio-header-tools">
    {headerTools}
    <span className={'solvia-online-indicator'+(online?'':' is-offline')} role="status" aria-label={online?'З’єднання із сервером активне':'Сервер недоступний'}>
      <span aria-hidden="true"/>{online?'На зв’язку':'Немає зв’язку'}
    </span>
    <div className="solvia-header-person" title={[staffName,roleLabel].filter(Boolean).join(' · ')}>
      <span className="solvia-header-avatar" aria-hidden="true">{initials}</span>
      <span className="solvia-header-person-info"><strong>{staffName}</strong><small>{roleLabel}</small></span>
    </div>
   </div>
  </header>
 </div>;
}
