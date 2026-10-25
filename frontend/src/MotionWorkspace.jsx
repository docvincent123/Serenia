import React,{useMemo,useState} from 'react';
import {modulesFor,timelineLayout} from './motion-workspace.mjs';
import {navigationGroups} from './workspace-model.mjs';

export function ModuleDirectory({role,onNavigate,Icon}){
 const [query,setQuery]=useState(''),[group,setGroup]=useState('all');
 const modules=useMemo(()=>modulesFor(role),[role]);
 const visible=modules.filter(m=>(group==='all'||m.group===group)&&`${m.title} ${m.description}`.toLocaleLowerCase('uk').includes(query.trim().toLocaleLowerCase('uk')));
 const groups=[...navigationGroups,['account','Особистий простір',[]]].filter(([id])=>modules.some(m=>m.group===id));
 return <section className="motion-modules">
  <header className="page-head"><div><div className="eyebrow">РОБОЧИЙ ПРОСТІР</div><h1>Усі розділи</h1><p>{role==='admin'?'Усі функції адміністратора — в одному просторі.':'Розділи та дії для вашої ролі.'}</p></div><span className="motion-access-chip">{modules.length} розділів{role==='admin'?' · Адміністратор':''}</span></header>
  <div className="motion-module-tools"><label className="motion-module-search"><Icon name="search"/><input type="search" aria-label="Знайти розділ" placeholder="Знайти розділ або функцію…" value={query} onChange={e=>setQuery(e.target.value)}/></label><div className="motion-group-filter" role="group" aria-label="Група розділів"><button aria-pressed={group==='all'} onClick={()=>setGroup('all')}>Усі</button>{groups.map(([id,title])=><button key={id} aria-pressed={group===id} onClick={()=>setGroup(id)}>{title}</button>)}</div></div>
  {role==='admin'&&<details className="motion-role-map"><summary>Розділи за ролями</summary><div className="motion-role-map-grid">{[['admin','Адміністратор'],['reception','Реєстратура'],['psychologist','Психолог'],['director','Керівник центру']].map(([key,title])=><article key={key}><h3>{title}</h3><span>{modulesFor(key).length} розділів</span><p>{modulesFor(key).map(m=>m.title).join(' · ')}</p></article>)}</div></details>}
  {groups.filter(([id])=>visible.some(m=>m.group===id)).map(([id,title])=><section className="motion-module-group" key={id}><div className="motion-section-title"><h2>{title}</h2><span>{visible.filter(m=>m.group===id).length} розділів</span></div><div className="motion-module-grid">{visible.filter(m=>m.group===id).map(m=><button className="motion-module-card" key={m.key} aria-label={`Відкрити розділ ${m.title}`} onClick={()=>onNavigate(m.key)}><span className="motion-module-icon"><Icon name={m.key}/></span><strong>{m.title}</strong><small>{m.description}</small><span className="motion-module-arrow" aria-hidden="true">↗</span></button>)}</div></section>)}
  {!visible.length&&<div className="surface motion-module-empty"><h2>Розділів не знайдено</h2><p>Спробуйте іншу назву або виберіть іншу групу.</p></div>}
 </section>;
}
export function PeriodActivity({stats,onNavigate}){
 const rows=stats.load||[],max=Math.max(1,...rows.map(p=>Number(p.appointments)||0));
 return <section className="surface motion-activity" aria-label="Записи за психологами"><div className="section-head"><div><div className="eyebrow">РОБОТА КОМАНДИ</div><h2>Кожна зустріч має значення.</h2><p>Записи за спеціалістами за обраний період.</p></div><button className="motion-text-link" onClick={()=>onNavigate('workload')}>Докладніше ↗</button></div>{rows.length?<div className="motion-bars">{rows.map((p,i)=><div className="motion-bar-column" key={`${p.name}-${i}`}><span>{p.appointments??0}</span><div className="motion-bar-track"><i style={{height:`${Math.max(0,Number(p.appointments)||0)/max*100}%`}}/></div><strong title={p.name}>{p.name}</strong><small>{p.hours??0} год у розкладі</small></div>)}</div>:<div className="motion-chart-empty">Записи з’являться після планування консультацій.</div>}</section>;
}
export function DayTimeline({appointments,psychologists,selected,onSelect,onEmptySlot,canSchedule}){
 const layout=useMemo(()=>timelineLayout(appointments,psychologists),[appointments,psychologists]);
 const hourHeight=64,height=(layout.end-layout.start)/60*hourHeight,hours=Array.from({length:(layout.end-layout.start)/60},(_,i)=>layout.start/60+i);
 const status=s=>({completed:'Проведено',cancelled:'Скасовано',no_show:'Не з’явився',confirmed:'Підтверджено',draft:'Чернетка',rescheduled:'Перенесено'}[s]||'Заплановано');
 return <div className="motion-timeline" aria-label="Денний розклад психологів">
  <div className="motion-timeline-scroll"><div className="motion-timeline-grid" style={{gridTemplateColumns:`58px repeat(${layout.columns.length},minmax(185px,1fr))`}}>
   <div className="motion-time-heading">ЧАС</div>{layout.columns.map(p=><div className="motion-psychologist-heading" key={p.id}><span>{p.name.slice(0,1)}</span><div><strong>{p.name}</strong><small>{p.events.length} записів</small></div></div>)}
   <div className="motion-time-axis" style={{height}}>{hours.map(h=><span key={h} style={{top:(h-layout.start/60)*hourHeight}}>{String(h).padStart(2,'0')}:00</span>)}</div>
   {layout.columns.map(column=><div className="motion-day-column" key={column.id} style={{height}}>
    {hours.map(h=>canSchedule?<button key={h} className="motion-empty-hour" style={{top:(h-layout.start/60)*hourHeight,height:hourHeight}} aria-label={`Новий запис: ${column.name}, ${String(h).padStart(2,'0')}:00`} onClick={()=>onEmptySlot({psychologistId:column.id==='empty'?undefined:column.id,start:`${String(h).padStart(2,'0')}:00`})}/>:<div className="motion-hour-line" key={h} style={{top:(h-layout.start/60)*hourHeight}}/>)}
    {column.events.map(({item,start,end,lane})=><button type="button" key={item.id} className={`appointment motion-timeline-appointment ${selected?.id===item.id?'selected':''} ${item.status} ${(end-start)<45?'motion-short':''} ${(end-start)<60?'motion-hide-meta':''}`} style={{top:(start-layout.start)/60*hourHeight+3,height:Math.max(14,(end-start)/60*hourHeight-4),left:`calc(${lane/column.lanes*100}% + 5px)`,width:`calc(${100/column.lanes}% - 10px)`}} onClick={()=>onSelect(item)} aria-pressed={selected?.id===item.id} title={`${item.start.slice(11,16)}–${item.end.slice(11,16)} · ${item.patients?.map(p=>p.name).join(', ')||'Консультація'} · ${status(item.status)}`}><span className="motion-event-time">{item.start.slice(11,16)} — {item.end.slice(11,16)}</span><strong>{item.kind==='group'?'Групове заняття':item.patients?.[0]?.name||'Консультація'}</strong><small>{item.room} · {status(item.status)}</small></button>)}
   </div>)}
  </div></div>
  {layout.invalid.length>0&&<div className="motion-invalid-times" role="status">{layout.invalid.map(item=><button key={item.id} className="appointment" onClick={()=>onSelect(item)}>{item.patients?.[0]?.name||'Консультація'} · Потрібно уточнити час</button>)}</div>}
 </div>;
}
