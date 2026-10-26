import React, {useEffect,useRef,useState} from 'react';
import {eventTitles} from './workflow-events.mjs';

// Uses the same server-side, role-filtered event endpoint as the header bell.
// No patient identifiers, diagnoses or consultation text are rendered here.
export default function RecentCenterEvents({api}) {
  const [expanded,setExpanded]=useState(false);
  const [events,setEvents]=useState([]);
  const [status,setStatus]=useState('');
  const apiRef=useRef(api);
  apiRef.current=api;
  useEffect(()=>{
    if(!expanded)return;
    let alive=true;
    async function load(){
      try{
        const result=await apiRef.current('GET','/api/workflow-events');
        if(!alive)return;
        if(!Array.isArray(result?.events)) {
          setStatus('Оновіть сервер SOLVIA для перегляду подій.');
          setEvents([]);
          return;
        }
        setEvents(result.events.filter(event=>event && eventTitles[event.kind])
          .sort((a,b)=>Number(b.id)-Number(a.id)).slice(0,5));
        setStatus('');
      }catch{
        if(alive)setStatus('Немає зв’язку зі стрічкою подій.');
      }
    }
    void load();
    const timer=setInterval(()=>{if(!document.hidden)void load();},15000);
    return()=>{alive=false;clearInterval(timer);};
  },[expanded]);
  return <section className="surface focus-recent-events" aria-label="Останні робочі події">
    <button className="focus-recent-toggle" type="button" aria-expanded={expanded}
      onClick={()=>setExpanded(v=>!v)}>
      <span><strong>Останні робочі події</strong><small>Записи, прибуття, виклики й завершені консультації</small></span>
      <span aria-hidden="true">{expanded?'−':'+'}</span>
    </button>
    {expanded&&<div className="focus-recent-list" aria-live="polite">
      {status&&<p role="status">{status}</p>}
      {!status&&!events.length&&<p>Робочих подій поки немає.</p>}
      {events.map(event=><div className="focus-recent-row" key={event.id}>
        <span className="focus-recent-mark" aria-hidden="true"/>
        <div><strong>{eventTitles[event.kind]}</strong><small>{[event.actor,event.created?.replace('T',' ').slice(0,16)].filter(Boolean).join(' · ')}</small></div>
      </div>)}
    </div>}
  </section>;
}
