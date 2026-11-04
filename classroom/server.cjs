'use strict';
const http=require('node:http');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const instructorNotes=require('./notes.cjs');
const ROOT=path.resolve(__dirname,'..');
const PORT=Number(process.env.PORT||8020);
const MAX_SLIDE=27,TTL=12*60*60*1000;
const rooms=new Map(),limits=new Map();
const assets={'/':'index.html','/index.html':'index.html','/workshop.css':'workshop.css','/workshop.js':'workshop.js','/workshop-data.js':'workshop-data.js'};
const allowed=(process.env.ALLOWED_ORIGINS||'https://e0o0juice-oss.github.io').split(',').map(s=>s.trim());
const headers={'X-Content-Type-Options':'nosniff','Referrer-Policy':'same-origin','Cache-Control':'no-store'};
function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8',...headers});res.end(JSON.stringify(data))}
function snapshot(room){return {index:room.index,maxIndex:room.maxIndex,revision:room.revision,timer:room.timer,expiresAt:room.expiresAt,ended:room.ended}}
function publish(room){room.revision++;const event='data: '+JSON.stringify(snapshot(room))+'\n\n';for(const c of room.clients)c.write(event)}
function end(room){room.ended=true;publish(room);for(const c of room.clients)c.end();rooms.delete(room.code)}
function validHost(room,req){const token=(req.headers.authorization||'').replace(/^Bearer /,'');const digest=crypto.createHash('sha256').update(token).digest();return crypto.timingSafeEqual(digest,room.hostHash)}
function originAllowed(req){const origin=req.headers.origin;if(!origin)return true;let own;try{own=new URL(origin)}catch{return false}return allowed.includes(origin)||own.host===req.headers.host}
async function body(req){if(!req.headers['content-type']?.startsWith('application/json'))throw Object.assign(Error('JSON 요청이 필요합니다.'),{status:415});let text='';for await(const chunk of req){text+=chunk;if(Buffer.byteLength(text)>8192)throw Object.assign(Error('요청이 너무 큽니다.'),{status:413})}try{return JSON.parse(text||'{}')}catch{throw Object.assign(Error('요청 형식이 올바르지 않습니다.'),{status:400})}}
const server=http.createServer(async(req,res)=>{try{
 if(!originAllowed(req))return json(res,403,{error:'허용되지 않은 사이트입니다.'});
 if(req.headers.origin){res.setHeader('Access-Control-Allow-Origin',req.headers.origin);res.setHeader('Vary','Origin')}
 if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type,Authorization','Access-Control-Max-Age':'600',...headers});return res.end()}
 const u=new URL(req.url,'http://localhost');
 if(u.pathname.startsWith('/api/')){
  const ip=req.socket.remoteAddress;const now=Date.now();let l=limits.get(ip);if(!l||l.until<now){l={count:0,until:now+60000};limits.set(ip,l)}if(++l.count>1000)return json(res,429,{error:'요청이 많습니다. 잠시 후 다시 시도하세요.'});
 }
 if(u.pathname==='/api/health'&&req.method==='GET')return json(res,200,{ok:true});
 if(u.pathname==='/api/rooms'&&req.method==='POST'){
  await body(req);if(rooms.size>=100)return json(res,503,{error:'현재 수업이 많습니다. 잠시 후 다시 시도하세요.'});
  let code;do{code=crypto.randomBytes(6).toString('hex').toUpperCase()}while(rooms.has(code));
  const hostToken=crypto.randomBytes(32).toString('hex');const room={code,hostHash:crypto.createHash('sha256').update(hostToken).digest(),index:0,maxIndex:0,revision:1,timer:{duration:600,remaining:600,end:null},clients:new Set(),expiresAt:Date.now()+TTL,ended:false};rooms.set(code,room);return json(res,201,{code,hostToken,state:snapshot(room)});
 }
 const match=u.pathname.match(/^\/api\/rooms\/([A-F0-9]{12})(?:\/(events|control|notes))?$/);
 if(match){const room=rooms.get(match[1]);if(!room||room.expiresAt<Date.now())return json(res,404,{error:'수업이 없거나 종료되었습니다. 강사에게 새 참여 주소를 받아주세요.'});
  if(req.method==='GET'&&!match[2])return json(res,200,snapshot(room));
  if(req.method==='GET'&&match[2]==='notes'){if(!validHost(room,req))return json(res,403,{error:'강사 권한이 필요합니다.'});return json(res,200,{notes:instructorNotes})}
  if(req.method==='GET'&&match[2]==='events'){
   if(room.clients.size>=60)return json(res,503,{error:'접속 가능한 인원을 초과했습니다.'});
   res.writeHead(200,{'Content-Type':'text/event-stream; charset=utf-8','Connection':'keep-alive','X-Accel-Buffering':'no',...headers});res.write('retry: 2000\ndata: '+JSON.stringify(snapshot(room))+'\n\n');room.clients.add(res);const keep=setInterval(()=>res.write(': heartbeat\n\n'),20000);req.on('close',()=>{clearInterval(keep);room.clients.delete(res)});return;
  }
  if(req.method==='POST'&&match[2]==='control'){
   if(!validHost(room,req))return json(res,403,{error:'강사 권한이 필요합니다.'});const data=await body(req);
   if(data.action==='slide'){
    if(!Number.isInteger(data.index)||data.index<0||data.index>MAX_SLIDE)return json(res,400,{error:'슬라이드 번호가 올바르지 않습니다.'});room.index=data.index;room.maxIndex=Math.max(room.maxIndex,data.index);
   }else if(data.action==='timer'){
    const t=room.timer;const left=t.end?Math.max(0,Math.ceil((t.end-Date.now())/1000)):t.remaining;
    if(data.command==='start'){t.remaining=left||t.duration;t.end=Date.now()+t.remaining*1000}
    else if(data.command==='pause'){t.remaining=left;t.end=null}
    else if(data.command==='reset'){t.remaining=t.duration;t.end=null}
    else if(data.command==='set'&&Number.isInteger(data.minutes)&&data.minutes>=1&&data.minutes<=180){t.duration=data.minutes*60;t.remaining=t.duration;t.end=null}
    else return json(res,400,{error:'타이머 설정이 올바르지 않습니다.'});
   }else if(data.action==='end'){end(room);return json(res,200,{ended:true})}
   else return json(res,400,{error:'지원하지 않는 동작입니다.'});publish(room);return json(res,200,snapshot(room));
  }
 }
 if(req.method==='GET'&&assets[u.pathname]){const file=assets[u.pathname];const ext=path.extname(file);const type={'.html':'text/html','.css':'text/css','.js':'text/javascript'}[ext];res.writeHead(200,{'Content-Type':type+'; charset=utf-8',...headers,'Content-Security-Policy':"default-src 'self'; connect-src 'self' https: http://localhost:* http://127.0.0.1:*; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"});fs.createReadStream(path.join(ROOT,file)).pipe(res);return}
 json(res,404,{error:'찾을 수 없는 주소입니다.'});
 }catch(e){if(!res.headersSent)json(res,e.status||500,{error:e.status?e.message:'서버 오류입니다. 다시 시도해주세요.'});else res.end()}
});
const cleanup=setInterval(()=>{for(const r of rooms.values())if(r.expiresAt<Date.now())end(r);for(const [ip,l]of limits)if(l.until<Date.now())limits.delete(ip)},60000);cleanup.unref();
if(require.main===module)server.listen(PORT,'0.0.0.0',()=>console.log(`BFLOW classroom listening on port ${PORT}`));
module.exports={server,rooms};
