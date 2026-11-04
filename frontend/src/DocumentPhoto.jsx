import React, {useEffect, useRef, useState} from 'react';

// Process photos locally; the retained original is a bounded, colour JPEG copy.
export default function DocumentPhoto({value, onChange, onError, onProcessingChange}) {
  const canvasRef=useRef(null);
  const workerRef=useRef(null), generation=useRef(0), imageRef=useRef(null);
  const [progress,setProgress]=useState('');
  const [recognizing,setRecognizing]=useState(false);
  useEffect(()=>()=>{++generation.current;workerRef.current?.terminate();imageRef.current?.close();},[]);
  function cancel() { ++generation.current; workerRef.current?.terminate();workerRef.current=null;setRecognizing(false);setProgress(''); }
  async function recognize(scan) {
    cancel(); const run=generation.current;
    setRecognizing(true);setProgress('Завантажуємо локальний модуль розпізнавання…');
    let worker;
    const timeout=setTimeout(()=>{if(run===generation.current){cancel();onError('Розпізнавання тривало надто довго. Скан можна зберегти без OCR.');}},60000);
    try {
      const {createWorker}=await import('tesseract.js');
      if(run!==generation.current)return;
      const base=new URL('./ocr/',document.baseURI).href;
      worker=await createWorker(['ukr','eng'],1,{workerPath:base+'worker.min.js',corePath:base+'core/',langPath:base+'lang',workerBlobURL:false,cacheMethod:'none',logger:m=>{if(run===generation.current)setProgress('Розпізнавання · '+Math.round((m.progress||0)*100)+'%');}});
      if(run!==generation.current)return;
      workerRef.current=worker;
      const {data}=await worker.recognize(scan);
      if(run!==generation.current)return;
      onChange(current=>({...current,content:data.text.trim().slice(0,10000)}));
      setProgress(data.text.trim()?'Текст перенесено в поле нижче. Перевірте помилки розпізнавання.':'Текст не знайдено. Перевірте фото або заповніть текст вручну.');
    } catch(e) { if(run===generation.current){setProgress('Скан готовий; текст можна вписати вручну.');onError('Не вдалося розпізнати текст. Перевірте наявність локального модуля OCR.');} }
    finally {clearTimeout(timeout);await worker?.terminate();if(run===generation.current){workerRef.current=null;setRecognizing(false);}}
  }
  const [image,setImage]=useState(null);
  const [rotation,setRotation]=useState(0);
  const [inset,setInset]=useState(0);
  const [busy,setBusy]=useState(false);
  useEffect(()=>{onProcessingChange?.(busy||recognizing);return()=>onProcessingChange?.(false);},[busy,recognizing,onProcessingChange]);
  function render(bitmap, angle, margin, original) {
    const canvas=canvasRef.current;
    const sw=Math.round(bitmap.width*(1-margin*2)), sh=Math.round(bitmap.height*(1-margin*2));
    canvas.width=angle%180?sh:sw; canvas.height=angle%180?sw:sh;
    const ctx=canvas.getContext('2d');
    ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);
    ctx.save();ctx.translate(canvas.width/2,canvas.height/2);ctx.rotate(angle*Math.PI/180);
    ctx.drawImage(bitmap,bitmap.width*margin,bitmap.height*margin,sw,sh,-sw/2,-sh/2,sw,sh);ctx.restore();
    const pixels=ctx.getImageData(0,0,canvas.width,canvas.height);
    const histogram=new Uint32Array(256);
    for(let i=0;i<pixels.data.length;i+=4){const g=Math.round(.299*pixels.data[i]+.587*pixels.data[i+1]+.114*pixels.data[i+2]);histogram[g]++;}
    const cutoff=canvas.width*canvas.height*.01;
    let low=0,high=255,total=0;
    while(low<254&&total+histogram[low]<cutoff)total+=histogram[low++];
    total=0;while(high>low+1&&total+histogram[high]<cutoff)total+=histogram[high--];
    for(let i=0;i<pixels.data.length;i+=4){const g=Math.round(.299*pixels.data[i]+.587*pixels.data[i+1]+.114*pixels.data[i+2]);const v=Math.max(0,Math.min(255,(g-low)*255/Math.max(1,high-low)));pixels.data[i]=pixels.data[i+1]=pixels.data[i+2]=v;}
    ctx.putImageData(pixels,0,0);
    const scan=canvas.toDataURL('image/jpeg',.85);
    if(scan.length>6000000)throw Error('Фото завелике. Виберіть менше зображення.');
    onChange(current=>({...current,source:'paper_scan',scan_data:scan,original_data:original,paper_signed:false,signature_data:''}));
    return scan;
  }
  async function load(file) {
    if(!file)return;
    cancel(); const request=++generation.current; setBusy(true);
    onChange(current=>({...current,scan_data:'',original_data:'',paper_signed:false,content:''}));
    try {
      if(!['image/jpeg','image/png'].includes(file.type)||file.size>20000000)throw Error('Оберіть JPEG/PNG до 20 МБ.');
      const bitmap=await createImageBitmap(file,{imageOrientation:'from-image'});
      if(bitmap.width*bitmap.height>60000000){bitmap.close();throw Error('Фото має бути до 60 мегапікселів.');}
      const scale=Math.min(1,2400/Math.max(bitmap.width,bitmap.height));
      const c=document.createElement('canvas');c.width=Math.round(bitmap.width*scale);c.height=Math.round(bitmap.height*scale);
      c.getContext('2d').fillStyle='#fff';c.getContext('2d').fillRect(0,0,c.width,c.height);c.getContext('2d').drawImage(bitmap,0,0,c.width,c.height);bitmap.close();
      const original=c.toDataURL('image/jpeg',.85);
      if(original.length>6000000)throw Error('Фото завелике. Виберіть менше зображення.');
      const bounded=await createImageBitmap(c);
      if(request!==generation.current){bounded.close();return;}
      imageRef.current?.close();imageRef.current=bounded;setImage(bounded);setRotation(0);setInset(0);
      const scan=render(bounded,0,0,original);void recognize(scan);
    } catch(e){if(request===generation.current)onError(e.message);} finally{if(request===generation.current||imageRef.current)setBusy(false);}
  }
  function update(angle,margin){if(!image)return;cancel();try{render(image,angle,margin,value.original_data);setRotation(angle);setInset(margin);setProgress('Скан змінено. Якщо текст уже розпізнано, перевірте його ще раз.');}catch(e){onError(e.message);}}
  return <section className="field full document-photo" aria-label="Сканування паперового документа">
    <div className="document-photo-heading">
      <div><strong>Сканування паперового документа</strong><p>Завантажте фото, перевірте краї та читабельність, після чого збережіть документ у картці.</p></div>
      <span className="document-photo-local">Обробка на пристрої</span>
    </div>
    <label className="document-photo-picker">
      <span className="document-photo-picker-title">{value.scan_data?'Замінити фотографію':'Обрати фотографію документа'}</span>
      <span>JPEG або PNG, до 20 МБ. Зображення обробляється локально.</span>
      <input type="file" accept="image/jpeg,image/png" disabled={busy||recognizing} onChange={e=>{void load(e.target.files?.[0]);e.target.value='';}}/>
    </label>
    <canvas ref={canvasRef} hidden />
    {progress&&<p role="status" className="document-photo-progress">{progress}</p>}
    {recognizing&&<button className="button secondary" type="button" onClick={cancel}>Зупинити розпізнавання</button>}
    {!!value.scan_data&&<>
      <div className="document-photo-toolbar" role="group" aria-label="Обробка сканованого документа">
        <button className="button secondary" type="button" disabled={recognizing||busy} onClick={()=>void recognize(value.scan_data)}>Повторити розпізнавання</button>
        <button className="button secondary" type="button" disabled={recognizing||busy} onClick={()=>update((rotation+90)%360,inset)}>Повернути на 90°</button>
        <label className="document-photo-crop">Обрізати поля <span>{Math.round(inset*100)}%</span>
          <input disabled={recognizing||busy} type="range" aria-label="Симетричне обрізання країв" min="0" max="0.2" step="0.01" value={inset} onChange={e=>update(rotation,Number(e.target.value))}/>
        </label>
        <button className="button secondary" type="button" disabled={recognizing||busy} onClick={()=>update(0,0)}>Скинути</button>
      </div>
      <div className="document-photo-compare">
        {value.original_data&&<figure><figcaption>Оригінальне фото</figcaption><img src={value.original_data} alt="Фото документа до обробки" loading="lazy"/></figure>}
        <figure><figcaption>Оброблений скан</figcaption><img src={value.scan_data} alt="Попередній перегляд обробленого скана" loading="lazy"/></figure>
      </div>
      <label className="paper-confirm document-photo-confirm"><input type="checkbox" checked={!!value.paper_signed} onChange={e=>onChange(current=>({...current,paper_signed:e.target.checked}))}/> Підтверджую, що підпис на оригінальному паперовому документі присутній та видимий на скані.</label>
    </>}
    <p className="document-photo-help">Текст розпізнається локально українською та англійською. Перед збереженням перевірте його вручну: OCR може помилятися, особливо в рукописних записах. Обрізайте поля лише так, щоб усі реквізити залишались видимими.</p>
  </section>;
}
