/**
 * Piper runs in a dedicated module Worker.
 * The worker can be terminated even if the Piper phonemizer / ONNX Runtime hangs.
 * Text is processed in small segments for visible synthesis progress.
 */
const SOURCE_ROOT = 'https://huggingface.co/diffusionstudio/piper-voices/resolve/main/';
const ALLOWED = new Set(['de_DE-kerstin-low','de_DE-thorsten-low','de_DE-thorsten-medium']);
const originalFetch = self.fetch.bind(self);
self.fetch = async (input,init) => {
 const url = typeof input==='string'?input:input instanceof URL?input.href:input?.url;
 if(typeof url==='string'&&url.startsWith(SOURCE_ROOT)){
  const m=url.match(/\/(de_DE-(?:kerstin-low|thorsten-low|thorsten-medium))\.onnx(\.json)?(?:\?.*)?$/);
  if(!m||!ALLOWED.has(m[1]))throw Error('Nicht erlaubte Piper-Modelldatei.');
  const path='/api/piper-model/'+m[1]+'.onnx'+(m[2]||'');
  const r=await originalFetch(new URL(path,self.location.origin),init);
  if(!r.ok)throw Error('Sprachmodell konnte nicht geladen werden (HTTP '+r.status+').');
  return r;
 }
 return originalFetch(input,init);
};
function partsFor(text,max=165){
 const sentences=(text.match(/[^.!?;\n]+[.!?;]?/g)||[text]).map(v=>v.trim()).filter(Boolean);
 const chunks=[];
 let current='';
 for(const sentence of sentences){
  for(const word of sentence.split(/\s+/)){
   if(current&&current.length+word.length+1>max){chunks.push(current);current=''}
   current+=(current?' ':'')+word;
  }
  if(current){chunks.push(current);current=''}
 }
 return chunks;
}
function pcmFromWav(buffer){
 const view=new DataView(buffer);
 if(buffer.byteLength<44||view.getUint32(0,false)!==0x52494646||view.getUint32(8,false)!==0x57415645)
  throw Error('Die Piper-Antwort ist keine unterstützte WAV-Datei.');
 let pos=12,rate=0,channels=0,bits=0,audioFormat=0,start=-1,length=0;
 while(pos+8<=buffer.byteLength){
  const type=view.getUint32(pos,false),size=view.getUint32(pos+4,true);
  const at=pos+8;if(at+size>buffer.byteLength)break;
  if(type===0x666d7420){audioFormat=view.getUint16(at,true);channels=view.getUint16(at+2,true);rate=view.getUint32(at+4,true);bits=view.getUint16(at+14,true)}
  if(type===0x64617461){start=at;length=size;break}
  pos=at+size+(size%2);
 }
 if(start<0||audioFormat!==1||channels!==1||bits!==16)throw Error('Das Piper-Audioformat wird nicht unterstützt.');
 return {pcm:new Uint8Array(buffer,start,length),rate};
}
async function mergeAudio(blobs){
 const sections=[];let total=0;let rate=0;
 for(const blob of blobs){
  const result=pcmFromWav(await blob.arrayBuffer());
  if(rate&&rate!==result.rate)throw Error('Unterschiedliche Piper-Abtastraten.');
  rate=result.rate;sections.push(result.pcm);total+=result.pcm.byteLength;
 }
 const out=new Uint8Array(44+total),view=new DataView(out.buffer);
 const ascii=(offset,str)=>{for(let i=0;i<str.length;i++)out[offset+i]=str.charCodeAt(i)};
 ascii(0,'RIFF');view.setUint32(4,out.length-8,true);ascii(8,'WAVE');ascii(12,'fmt ');
 view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
 view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);
 ascii(36,'data');view.setUint32(40,total,true);
 let off=44;for(const section of sections){out.set(section,off);off+=section.length}
 return new Blob([out],{type:'audio/wav'});
}
async function loadPiper(){
 const sources=[
  'https://esm.sh/@mintplex-labs/piper-tts-web@1.0.5?bundle&deps=onnxruntime-web@1.18.0',
  'https://esm.run/@mintplex-labs/piper-tts-web@1.0.5'
 ];
 const errors=[];
 for(const url of sources){
  try{const mod=await import(url);if(typeof mod.TtsSession?.create==='function')return mod;errors.push('Piper-Bibliothek ohne TtsSession');}
  catch(e){errors.push(new URL(url).hostname+': '+String(e?.message||e).slice(0,120))}
 }
 throw Error('Bibliothek nicht geladen: '+errors.join(' / '));
}
self.onmessage=async({data})=>{
 if(data?.type!=='generate')return;
 try{
  const text=String(data.text||'').trim().slice(0,2000);
  const voiceId=data.voiceId;
  if(!text||!ALLOWED.has(voiceId))throw Error('Sprechertext oder Stimme ungültig.');
  self.postMessage({type:'stage',stage:'Bibliothek',message:'Schritt 1/3: Piper-Bibliothek laden'});
  const tts=await loadPiper();
  self.postMessage({type:'stage',stage:'Sprachmodell',message:'Schritt 2/3: Sprachmodell und Laufzeit laden'});
  const session=await tts.TtsSession.create({
   voiceId,
   progress:p=>{
    const percent=p&&p.total>0?Math.round(p.loaded/p.total*100):null;
    self.postMessage({type:'download',percent,loaded:p?.loaded||0,total:p?.total||0});
   },
   wasmPaths:{
    onnxWasm:self.location.origin+'/api/piper-runtime/onnx/',
    piperData:self.location.origin+'/api/piper-runtime/piper_phonemize.data',
    piperWasm:self.location.origin+'/api/piper-runtime/piper_phonemize.wasm'
   }
  });
  const chunks=partsFor(data.shortTest?'Hallo! Das ist ein kurzer Test unserer kostenlosen deutschen Sprecherstimme.':text);
  if(!chunks.length)throw Error('Kein Sprechertext vorhanden.');
  const wavs=[];
  for(let i=0;i<chunks.length;i++){
   self.postMessage({type:'stage',stage:'Synthese',index:i+1,total:chunks.length,message:'Schritt 3/3: Abschnitt '+(i+1)+' von '+chunks.length+' wird gesprochen'});
   const audio=await session.predict(chunks[i]);
   if(!audio?.size)throw Error('Die Audioausgabe ist leer.');
   wavs.push(audio);
   self.postMessage({type:'partComplete',index:i+1,total:chunks.length});
   await new Promise(resolve=>setTimeout(resolve,10));
  }
  const result=await mergeAudio(wavs);
  self.postMessage({type:'result',audio:result,bytes:result.size,parts:chunks.length});
 }catch(e){
  self.postMessage({type:'error',error:String(e?.message||e).slice(0,450)});
 }
};
