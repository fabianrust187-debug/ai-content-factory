/** Cloudflare Worker: static app + optional server-side AI and TTS. */
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
function authorize(req,env){const token=req.headers.get('X-Studio-Key')||'';return typeof env.STUDIO_ACCESS_KEY==='string'&&env.STUDIO_ACCESS_KEY.length>=16&&token===env.STUDIO_ACCESS_KEY}
function text(v,max=1500){return String(v??'').replace(/[\u0000-\u001F\u007F]/g,' ').trim().slice(0,max)}
const PIPER_MODELS = Object.freeze({
 'de_DE-thorsten-medium':'de/de_DE/thorsten/medium/de_DE-thorsten-medium.onnx',
 'de_DE-thorsten-high':'de/de_DE/thorsten/high/de_DE-thorsten-high.onnx'
});
const PIPER_HF_BASE='https://huggingface.co/diffusionstudio/piper-voices/resolve/main/';
const PIPER_DATA_BASE='https://cdn.jsdelivr.net/npm/@diffusionstudio/piper-wasm@1.0.0/build/';
const PIPER_ONNX_BASE='https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web/1.18.0/';
async function piperStatusCheck(){
 const urls=[
  ['Modell-Konfiguration',PIPER_HF_BASE+PIPER_MODELS['de_DE-thorsten-medium']+'.json'],
  ['Piper-Laufzeit',PIPER_DATA_BASE+'piper_phonemize.data'],
  ['ONNX-Laufzeit',PIPER_ONNX_BASE+'ort-wasm-simd.wasm']
 ];
 const results=await Promise.all(urls.map(async ([name,url])=>{
  try{const r=await fetch(url,{method:'HEAD',redirect:'follow',signal:AbortSignal.timeout(12000)});return {name,status:r.status,ok:r.ok};}
  catch(e){return {name,status:0,ok:false,error:String(e?.name||'Netzwerkfehler')};}
 }));
 return json({status:results.every(x=>x.ok)?'verfuegbar':'eingeschraenkt',sources:results});
}
async function piperAsset(req,path){
 if(req.method!=='GET')return json({error:'Methode nicht erlaubt'},405);
 let source;
 const m=path.match(/^\/api\/piper-model\/([a-zA-Z0-9_-]+)\.onnx(\.json)?$/);
 if(m&&PIPER_MODELS[m[1]])source=PIPER_HF_BASE+PIPER_MODELS[m[1]]+(m[2]||'');
 else if(path==='/api/piper-runtime/piper_phonemize.data'||path==='/api/piper-runtime/piper_phonemize.wasm'){
  source=PIPER_DATA_BASE+path.split('/').at(-1);
 }else{
  const n=path.match(/^\/api\/piper-runtime\/onnx\/(ort-wasm[a-z0-9.-]*\.(?:wasm|mjs|js))$/);
  if(n)source=PIPER_ONNX_BASE+n[1];
 }
 if(!source)return json({error:'Piper-Datei nicht erlaubt'},404);
 try{
  const upstream=await fetch(source,{redirect:'follow',signal:AbortSignal.timeout(120000),cf:{cacheEverything:true,cacheTtl:86400}});
  if(!upstream.ok)return json({error:'Piper-Datei konnte nicht heruntergeladen werden',status:upstream.status,resource:path.split('/').at(-1)},502);
  const headers=new Headers({'Cache-Control':'public,max-age=86400','X-Content-Type-Options':'nosniff'});
  headers.set('Content-Type',upstream.headers.get('Content-Type')||(path.endsWith('.json')?'application/json':path.endsWith('.wasm')?'application/wasm':'application/octet-stream'));
  const size=upstream.headers.get('Content-Length');if(size)headers.set('Content-Length',size);
  return new Response(upstream.body,{status:200,headers});
 }catch(e){
  console.warn('Piper download failure',{resource:path,error:String(e?.name||'network')});
  return json({error:'Piper-Download über Cloudflare derzeit nicht erreichbar',resource:path.split('/').at(-1)},502);
 }
}

export default {async fetch(req,env){const path=new URL(req.url).pathname;
 if(path==='/api/piper-check'&&req.method==='GET')return piperStatusCheck();
 if(path.startsWith('/api/piper-model/')||path.startsWith('/api/piper-runtime/'))return piperAsset(req,path);
 if(path==='/api/health'&&req.method==='GET')return json({aiConfigured:Boolean(env.OPENAI_API_KEY&&env.STUDIO_ACCESS_KEY),voiceConfigured:Boolean(env.OPENAI_API_KEY&&env.STUDIO_ACCESS_KEY)});
 if(path.startsWith('/api/')){
  if(req.method!=='POST')return json({error:'Methode nicht erlaubt'},405);
  if(!authorize(req,env))return json({error:'Ungültiger Studio-Zugangsschlüssel. In Cloudflare STUDIO_ACCESS_KEY setzen (mindestens 16 Zeichen).'},401);
  if(!env.OPENAI_API_KEY)return json({error:'OPENAI_API_KEY ist nicht konfiguriert.'},503);
  if(+(req.headers.get('Content-Length')||0)>15000)return json({error:'Anfrage zu groß'},413);
  let data;try{data=await req.json()}catch{return json({error:'Ungültiges JSON'},400)}
  if(path==='/api/generate'){
   const topic=text(data.topic,800);if(!topic)return json({error:'Thema fehlt'},400);
   const duration=Math.min(45,Math.max(15,Number(data.duration)||30));
   const system=`Du bist ein präziser deutschsprachiger Social-Media-Redakteur. Erstelle EXAKT 3 klar unterschiedliche Kurzvideo-Konzepte, einmal Hook-first, einmal praktische Tipps, einmal authentisch/persönlich. Kein erfundenes Kundenfeedback, keine unrealistischen Behauptungen, keine erfundenen Ergebnisse. Antworte ausschließlich als JSON-Objekt mit {"drafts":[{"title":"...","hook":"...","script":"...","postText":"...","scenes":["Caption1","Caption2","Caption3","Caption4"]}, ...]}. Für jedes Script maximal 110 Wörter, jeden Caption höchstens 85 Zeichen. Geeignete deutsche Hashtags. Szenen auf ca. ${duration} Sekunden ausrichten.`;
   const user=`Projekt: ${text(data.brand,100)}. Thema: ${topic}. Zielgruppe: ${text(data.audience,160)}. Plattform: ${text(data.platform,80)}. Ziel: ${text(data.goal,80)}. Ton: ${text(data.tone,80)}. Bevorzuge einen ungekünstelten und konkreten Stil.`;
   try{const r=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{'Authorization':`Bearer ${env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:env.AI_MODEL||'gpt-4.1-mini',temperature:0.7,response_format:{type:'json_object'},messages:[{role:'system',content:system},{role:'user',content:user}]})});if(!r.ok)return json({error:'KI-Anbieter hat die Anfrage abgelehnt.'},502);const j=await r.json();let result;try{result=JSON.parse(j.choices?.[0]?.message?.content||'{}')}catch{return json({error:'KI-Antwort enthält kein gültiges JSON.'},502)};if(!Array.isArray(result.drafts)||result.drafts.length<3)return json({error:'KI lieferte weniger als drei Konzepte.'},502);return json({drafts:result.drafts.slice(0,3)})}catch{return json({error:'KI-Dienst derzeit nicht erreichbar.'},502)}
  }
  if(path==='/api/voice'){
   const speech=text(data.text,2000);if(!speech)return json({error:'Sprechertext fehlt.'},400);
   try{const r=await fetch('https://api.openai.com/v1/audio/speech',{method:'POST',headers:{'Authorization':`Bearer ${env.OPENAI_API_KEY}`,'Content-Type':'application/json'},body:JSON.stringify({model:env.TTS_MODEL||'gpt-4o-mini-tts',voice:env.TTS_VOICE||'coral',input:speech,response_format:'mp3'})});if(!r.ok){
    let code='',kind='';
    try{const err=(await r.json())?.error||{};code=String(err.code||'').slice(0,80);kind=String(err.type||'').slice(0,80)}catch{}
    const marker=(code+' '+kind).toLowerCase();
    let message='Sprachgenerierung wurde vom KI-Anbieter abgelehnt.';
    if(r.status===401)message='Der OpenAI-API-Schlüssel wurde abgelehnt. Bitte OPENAI_API_KEY in Cloudflare prüfen.';
    else if(r.status===403)message='Dein OpenAI-Projekt hat keinen Zugriff auf die Sprachgenerierung. Bitte Modellberechtigung und Projekteinstellungen prüfen.';
    else if(r.status===404)message='Das konfigurierte Sprachmodell ist nicht verfügbar. Bitte TTS_MODEL in Cloudflare prüfen.';
    else if(r.status===429&&/insufficient_quota|credit_balance_exhausted|billing|spend_limit|usage_limit/.test(marker))message='OpenAI-API-Guthaben oder Ausgabenlimit erreicht. Bitte die API-Abrechnung unter platform.openai.com prüfen.';
    else if(r.status===429)message='OpenAI hat ein Anfragelimit erreicht. Bitte kurz warten und erneut versuchen.';
    else if(r.status===400)message='Die Sprachanfrage wurde abgelehnt. Bitte TTS_MODEL, TTS_VOICE und Sprechertext prüfen.';
    else if(r.status>=500)message='Der Sprachdienst ist vorübergehend nicht verfügbar. Bitte später erneut versuchen.';
    const safeCode=/^[a-zA-Z0-9_.-]{1,64}$/.test(code)?code:undefined;
    console.warn('TTS provider failure',{status:r.status,code:safeCode,type:kind.replace(/[^\w.-]/g,'').slice(0,64),requestId:r.headers.get('x-request-id')||undefined});
    return json({error:message,providerStatus:r.status,providerCode:safeCode},502);
   }return new Response(r.body,{status:200,headers:{'Content-Type':'audio/mpeg','Cache-Control':'no-store'}})}catch{return json({error:'Sprachdienst derzeit nicht erreichbar.'},502)}
  }
  return json({error:'Route nicht gefunden'},404)
 }
 return env.ASSETS.fetch(req)
 }};
