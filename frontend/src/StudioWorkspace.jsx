import React from 'react';

// A single, quiet studio header. Staff navigate using the existing sidebar or
// module directory, not a second row of duplicated tabs.
export default function StudioWorkspace({headerTools=null}){
 return <div className="studio-chrome studio-chrome-header">
  <header className="studio-header">
   <div className="studio-identity"><img className="studio-mark" src="/solvia-icon.png" alt="" aria-hidden="true"/><span className="studio-wordmark">SOLVIA</span><span className="studio-header-divider"/><span className="studio-center-label">Робочий простір центру</span></div>
   <div className="studio-header-tools">{headerTools}</div>
  </header>
 </div>;
}
