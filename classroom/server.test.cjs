'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const {once}=require('node:events');const {server}=require('./server.cjs');
test('instructor permissions, stage boundary, synchronized stream, timer, and end lifecycle',async()=>{server.listen(0,'127.0.0.1');await once(server,'listening');const base='http://127.0.0.1:'+server.address().port;const post=(url,data,token)=>fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(data)});let reader;try{
const room=await (await post('/api/rooms',{})).json();assert.match(room.code,/^[A-F0-9]{12}$/);const url='/api/rooms/'+room.code;
const state=await(await fetch(base+url)).json();assert.equal(state.index,0);assert(!('hostToken'in state));
for(const token of [null,'wrong'])assert.equal((await post(url+'/control',{action:'slide',index:5},token)).status,403);
assert.equal((await post(url+'/control',{action:'slide',index:28},room.hostToken)).status,400);
assert.equal((await post(url+'/control',{action:'slide',index:-1},room.hostToken)).status,400);
const events=await fetch(base+url+'/events');reader=events.body.getReader();assert.match(new TextDecoder().decode((await reader.read()).value),/"index":0/);
let next=await(await post(url+'/control',{action:'slide',index:3},room.hostToken)).json();assert.equal(next.maxIndex,3);assert.match(new TextDecoder().decode((await reader.read()).value),/"index":3/);
next=await(await post(url+'/control',{action:'slide',index:1},room.hostToken)).json();assert.equal(next.index,1);assert.equal(next.maxIndex,3);
assert.equal((await post(url+'/control',{action:'timer',command:'set',minutes:0},room.hostToken)).status,400);
for(const command of ['set','start','pause','reset']){next=await(await post(url+'/control',{action:'timer',command,minutes:2},room.hostToken)).json();assert.equal(next.timer.duration,120);if(command==='start')assert(next.timer.end>Date.now());else assert.equal(next.timer.end,null)}
assert.equal((await post('/api/rooms',{},null)).status,201);
const denied=await fetch(base+'/api/rooms',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://evil.example'},body:'{}'});assert.equal(denied.status,403);
assert.equal((await fetch(base+'/classroom/server.cjs')).status,404);
assert.equal((await post(url+'/control',{action:'end'},room.hostToken)).status,200);assert.equal((await fetch(base+url)).status,404);
}finally{await reader?.cancel();server.closeAllConnections();await new Promise(r=>server.close(r))}});
