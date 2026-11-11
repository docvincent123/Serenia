import React,{useEffect,useState} from 'react';

// The tenant identity comes from the current installation, not from branding
// text or the connected operator's name. No patient data is requested here.
export default function StudioWorkspace({api,headerTools=null}){
  const [center,setCenter]=useState(null);
  useEffect(()=>{
    let active=true;
    const load=async()=>{try{
      const data=await api('GET','/api/center-identity');
      if(active)setCenter(data);
    }catch{if(active)setCenter(null);}};
    void load();
    const timer=setInterval(()=>{if(!document.hidden)void load();},300000);
    const refresh=()=>{void load();};
    window.addEventListener('solvia:center-updated',refresh);
    return()=>{active=false;clearInterval(timer);window.removeEventListener('solvia:center-updated',refresh);};
  },[api]);
  const name=center?.name?.trim()||'Психологічний центр';
  return <div className="studio-chrome studio-chrome-header">
    <header className="studio-header">
      <div className="studio-identity">
        <img className="studio-mark" src="/lemvori-care.svg" alt="" aria-hidden="true"/>
        <div className="care-identity-text"><span className="studio-wordmark">Lemvori <span>Care</span></span>
          <span className="care-center-name" title={name}>{name}</span>
        </div>
        <span className="studio-header-divider"/>
        <span className="care-center-city">{center?.city||'Робочий простір центру'}</span>
      </div>
      <div className="studio-header-tools">{headerTools}</div>
    </header>
  </div>;
}
