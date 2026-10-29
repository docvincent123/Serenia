import {useEffect,useRef,useState} from 'react';

export default function usePatientDirectory(api,{search,page,status,pageSize=25,enabled=true}){
 const apiRef=useRef(api),sequence=useRef(0);
 apiRef.current=api;
 const key=JSON.stringify([search.trim(),page,status,pageSize,enabled]);
 const [result,setResult]=useState({key:'',items:[],total:0,loading:true,error:''});
 const [revision,setRevision]=useState(0);
 useEffect(()=>{
  const request=++sequence.current;
  if(!enabled)return;
  setResult({key,items:[],total:0,loading:true,error:''});
  const timer=setTimeout(async()=>{
   try{
    const params=new URLSearchParams({q:search.trim(),page:String(page),page_size:String(pageSize),status});
    const data=await apiRef.current('GET',`/api/patient-directory?${params}`);
    if(!Array.isArray(data?.items)||!Number.isInteger(data.total))throw new Error('Не вдалося прочитати реєстр. Оновіть сервер SOLVIA.');
    if(sequence.current===request)setResult({...data,key,loading:false,error:''});
   }catch(e){if(sequence.current===request)setResult({key,items:[],total:0,loading:false,error:e.message});}
  },search.trim()?250:0);
  return()=>{clearTimeout(timer);++sequence.current;};
 },[key,revision]);
 const current=enabled&&result.key===key?result:{items:[],total:0,loading:enabled,error:''};
 return {...current,reload:()=>setRevision(n=>n+1)};
}
