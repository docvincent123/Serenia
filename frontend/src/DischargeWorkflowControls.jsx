import React,{useState} from 'react';

export const dischargeStatusText = {
  legacy:'Архівна виписка',
  draft:'Чернетка',
  review:'Очікує погодження керівника',
  approved:'Погоджено'
};

export function canPrintDischarge(item){
  return item?.workflow_status==='approved'||item?.workflow_status==='legacy';
}

export default function DischargeWorkflowControls({api,item,role,onSaved}){
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [returning,setReturning]=useState(false);
  const [reason,setReason]=useState('');
  const isHead=role==='admin'||role==='director';
  const isPsychologist=role==='psychologist';
  const state=item?.workflow_status||'legacy';
  async function act(action){
    if(busy)return;
    setBusy(true);setError('');
    try{
      await api('POST',`/api/discharges/${item.id}/workflow`,{
        revision:item.revision,
        action,
        ...(action==='return'?{reason:reason.trim()}:{})
      });
      setReturning(false);setReason('');
      await onSaved();
    }catch(e){setError(e.message||'Не вдалося змінити статус виписки.');}
    finally{setBusy(false);}
  }
  return <div className="discharge-workflow">
    <span className={`discharge-state discharge-state-${state}`}>{dischargeStatusText[state]||state}</span>
    {isPsychologist&&state==='draft'&&
      <button className="button secondary" disabled={busy} type="button" onClick={()=>act('submit')}>Підтвердити й подати керівнику</button>}
    {isHead&&state==='review'&&<>
      <button className="button primary" type="button" disabled={busy} onClick={()=>act('approve')}>Погодити виписку</button>
      <button className="button secondary" type="button" disabled={busy} onClick={()=>setReturning(v=>!v)}>Повернути на доопрацювання</button>
      {returning&&<form className="discharge-return" onSubmit={e=>{e.preventDefault();if(reason.trim())void act('return');}}>
        <label>Причина повернення <textarea rows={2} maxLength={1000} required value={reason} onChange={e=>setReason(e.target.value)} placeholder="Наприклад: уточнити рекомендації"/></label>
        <button className="button secondary" disabled={busy||!reason.trim()} type="submit">Повернути психологу</button>
      </form>}
    </>}
    {state==='approved'&&item.approved_at&&<small>Погоджено {item.approved_at.replace('T',' ')}{item.approved_by_name?' · '+item.approved_by_name:''}</small>}
    {state==='draft'&&item.return_reason&&<small>Повернено: {item.return_reason}</small>}
    {error&&<span className="alert error" role="alert">{error}</span>}
  </div>;
}
