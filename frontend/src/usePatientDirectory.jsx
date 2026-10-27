import {useEffect,useRef,useState} from 'react';

export default function usePatientDirectory(api,{search,page,status}){
 const apiRef=useRef(api),sequence=useRef(0);
 apiRef.current=api;
 const [result,setResult]=useState({items:[],total:0});
 const [loading,setLoading]=useState(true),[error,setError]=useState(''),[revision,setRevision]=useState(0);
 useEffect(()=>{
  const request=++sequence.current;
  setLoading(true);setError('');
  const timer=setTimeout(async()=>{
   try{
    const params=new URLSearchParams({q:search.trim(),page:String(page),page_size:'25',status});
    const data=await apiRef.current('GET',`/api/patient-directory?${params}`);
    if(!Array.isArray(data?.items)||!Number.isInteger(data.total))throw new Error('Не вдалося прочитати реєстр. Оновіть сервер SOLVIA.');
    if(sequence.current===request)setResult(data);
   }catch(e){if(sequence.current===request)setError(e.message);}
   finally{if(sequence.current===request)setLoading(false);}
  },search.trim()?250:0);
  return()=>{clearTimeout(timer);++sequence.current;};
 },[search,page,status,revision]);
 return {...result,loading,error,reload:()=>setRevision(n=>n+1)};
}
