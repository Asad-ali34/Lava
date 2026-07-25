'use strict';
const http = require('http');
const fs   = require('fs');
const path = require('path');
const { WebSocket, WebSocketServer } = require('ws');

const PORT = process.env.PORT || 5000;
const MIME = {
  '.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8',
  '.js':'application/javascript; charset=utf-8','.json':'application/json',
  '.ico':'image/x-icon','.png':'image/png','.svg':'image/svg+xml',
};

// ── Node config (edit here OR set LAVALINK_NODES env var) ────────────────────
// Format: JSON array of node objects
const DEFAULT_NODES = [
  { id:'node1', name:'Main Node', host:'5.39.63.207', port:9261, password:'glace', secure:false },
  // Add more nodes here:
  // { id:'node2', name:'My Node 2', host:'1.2.3.4', port:2333, password:'youmustconfigure', secure:false },
];
const NODES = (() => {
  try { return JSON.parse(process.env.LAVALINK_NODES); } catch {}
  return DEFAULT_NODES;
})();

// ── Per-node state ────────────────────────────────────────────────────────────
const nodeState = NODES.map(() => ({
  stats:null, ping:null, online:false,
  sessionIds:new Set(), playerCache:new Map(), wsProxyData:new Map(),
  ws:null, wsSessionId:null,
}));

function nodeBase(n)  { return `${n.secure?'https':'http'}://${n.host}:${n.port}`; }
function nodeWsUrl(n) { return `${n.secure?'wss':'ws'}://${n.host}:${n.port}/v4/websocket`; }

// ── Monitor WS auto-connect ───────────────────────────────────────────────────
function connectMonitorWs(idx) {
  const n=NODES[idx], st=nodeState[idx];
  if (st.ws && st.ws.readyState < 2) return;
  const ws = new WebSocket(nodeWsUrl(n), {
    headers:{ Authorization:n.password, 'User-Id':'1', 'Client-Name':'LavalinkMonitor/2.0' },
  });
  st.ws = ws;
  ws.on('open', () => { st.online=true; console.log(`[${n.name}] Monitor WS connected`); });
  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.op==='ready' && msg.sessionId) {
        st.wsSessionId=msg.sessionId; st.sessionIds.add(msg.sessionId);
        console.log(`[${n.name}] Session: ${msg.sessionId}`);
        pollNodePlayers(idx);
      }
      if (msg.type==='TrackStartEvent' && st.wsSessionId) {
        const g=st.playerCache.get(st.wsSessionId)||new Map();
        g.set(msg.guildId,{...(g.get(msg.guildId)||{}),track:msg.track,paused:false});
        st.playerCache.set(st.wsSessionId,g);
      }
    } catch {}
  });
  ws.on('close',()=>{ st.ws=null; setTimeout(()=>connectMonitorWs(idx),5000); });
  ws.on('error',e=>console.error(`[${n.name}] WS: ${e.message}`));
}

// ── Poll ──────────────────────────────────────────────────────────────────────
async function pollNodePlayers(idx) {
  const n=NODES[idx], st=nodeState[idx];
  for (const sid of st.sessionIds) {
    try {
      const r=await fetch(`${nodeBase(n)}/v4/sessions/${sid}/players`,{headers:{Authorization:n.password},signal:AbortSignal.timeout(5000)});
      if (!r.ok){if(r.status===404)st.sessionIds.delete(sid);continue;}
      const players=await r.json(); if(!Array.isArray(players))continue;
      if(!st.playerCache.has(sid))st.playerCache.set(sid,new Map());
      const map=st.playerCache.get(sid); map.clear();
      players.forEach(p=>{if(p?.guildId)map.set(p.guildId,{track:p.track,paused:p.paused??false,volume:p.volume??100,state:p.state??{}});});
    } catch {}
  }
}

async function pollAll() {
  await Promise.allSettled(NODES.map(async(n,i)=>{
    const st=nodeState[i];
    try {
      const t0=Date.now(), r=await fetch(`${nodeBase(n)}/v4/stats`,{headers:{Authorization:n.password},signal:AbortSignal.timeout(6000)});
      if(!r.ok)throw new Error(`HTTP ${r.status}`);
      st.stats=await r.json(); st.ping=Date.now()-t0; st.online=true;
    } catch { st.online=false; st.stats=null; }
  }));
  await Promise.allSettled(NODES.map((_,i)=>pollNodePlayers(i)));
}

pollAll();
setInterval(pollAll, 4000);
NODES.forEach((_,i)=>connectMonitorWs(i));

// ── Helpers ───────────────────────────────────────────────────────────────────
function json(res,code,obj){res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(obj));}

function collectPlayers(idx) {
  const st=nodeState[idx], out=[], seen=new Set();
  for(const[sid,g]of st.playerCache) for(const[gid,s]of g){out.push({sessionId:sid,guildId:gid,...s});seen.add(gid);}
  for(const[sid,g]of st.wsProxyData) for(const[gid,s]of g) if(!seen.has(gid)){out.push({sessionId:sid,guildId:gid,...s});seen.add(gid);}
  return out;
}

// ── HTTP ──────────────────────────────────────────────────────────────────────
const server = http.createServer(async(req,res)=>{
  const u=new URL(req.url,'http://localhost'), p=u.pathname;
  res.setHeader('Access-Control-Allow-Origin','*');
  res.setHeader('Cache-Control','no-store');

  if(p==='/api/nodes'){
    json(res,200,{ok:true,nodes:NODES.map((n,i)=>{
      const st=nodeState[i],pl=collectPlayers(i);
      return{id:n.id,name:n.name,host:n.host,port:n.port,secure:n.secure,online:st.online,ping:st.ping,stats:st.stats,
        playerCount:pl.length,playingCount:pl.filter(p=>p.track&&!p.paused).length,sessions:[...st.sessionIds]};
    })});return;
  }

  if(p==='/api/players'){
    const players=[];
    NODES.forEach((n,i)=>collectPlayers(i).forEach(pl=>players.push({...pl,nodeName:n.name,nodeId:n.id})));
    json(res,200,{ok:true,players,sessionCount:NODES.reduce((a,_,i)=>a+nodeState[i].sessionIds.size,0)});return;
  }

  if(p==='/api/search'){
    const q=(u.searchParams.get('q')||'').trim(),source=u.searchParams.get('source')||'yt';
    const idx=Math.max(0,Math.min(NODES.length-1,+(u.searchParams.get('node')||0)));
    const n=NODES[idx]||NODES[0]; if(!n){json(res,503,{ok:false,error:'No nodes'});return;}
    if(!q){json(res,200,{ok:true,tracks:[]});return;}
    let ids=/^https?:\/\//.test(q)?[q]:source==='sc'?[`scsearch:${q}`]:source==='all'?[`ytsearch:${q}`,`scsearch:${q}`]:[`ytsearch:${q}`];
    try{
      const results=await Promise.all(ids.map(async id=>{
        const r=await fetch(`${nodeBase(n)}/v4/loadtracks?identifier=${encodeURIComponent(id)}`,{headers:{Authorization:n.password},signal:AbortSignal.timeout(12000)});
        if(!r.ok)return[]; const d=await r.json(); return Array.isArray(d.data)?d.data:[];
      }));
      const all=[];
      if(ids.length>1){const mx=Math.max(...results.map(r=>r.length));for(let i=0;i<mx;i++)results.forEach(r=>{if(r[i])all.push(r[i]);});}
      else all.push(...(results[0]||[]));
      json(res,200,{ok:true,tracks:all.slice(0,30)});
    }catch(e){json(res,503,{ok:false,error:e.message});}
    return;
  }

  if(p==='/api/lyrics'){
    const title=u.searchParams.get('title')||'',artist=u.searchParams.get('artist')||'',duration=u.searchParams.get('duration')||'';
    try{
      const qs=new URLSearchParams({track_name:title,artist_name:artist,...(duration?{duration:Math.floor(+duration/1000)}:{})});
      const r=await fetch(`https://lrclib.net/api/get?${qs}`,{headers:{'Lrclib-Client':'LavalinkMonitor/2.0'},signal:AbortSignal.timeout(6000)});
      if(r.status===404){json(res,200,{ok:true,lyrics:null});return;}
      if(!r.ok)throw new Error(`LRCLib ${r.status}`);
      const d=await r.json();
      json(res,200,{ok:true,lyrics:d.plainLyrics||null,syncedLyrics:d.syncedLyrics||null,hasLyrics:!!(d.plainLyrics||d.syncedLyrics)});
    }catch{json(res,200,{ok:true,lyrics:null});}
    return;
  }

  if(p==='/api/register'&&req.method==='POST'){
    let body=''; req.on('data',c=>body+=c);
    req.on('end',()=>{
      try{
        const{sessionId,nodeId}=JSON.parse(body); if(!sessionId){json(res,400,{ok:false,error:'Missing sessionId'});return;}
        const idx=nodeId?NODES.findIndex(n=>n.id===nodeId):0;
        if(idx>=0){nodeState[idx].sessionIds.add(sessionId.trim());pollNodePlayers(idx);}
        json(res,200,{ok:true});
      }catch{json(res,400,{ok:false,error:'Invalid JSON'});}
    });return;
  }

  // Static files
  const file=p==='/'?'index.html':p.replace(/^\//,'');
  const abs=path.join(__dirname,file.replace(/\.\./g,''));
  // Don't serve api/ source files directly
  if(abs.includes(`${path.sep}api${path.sep}`)){res.writeHead(404);res.end('Not found');return;}
  fs.readFile(abs,(err,data)=>{
    if(err){fs.readFile(path.join(__dirname,'index.html'),(e2,d2)=>{if(e2){res.writeHead(404);res.end('Not found');return;}res.writeHead(200,{'Content-Type':MIME['.html']});res.end(d2);});return;}
    res.writeHead(200,{'Content-Type':MIME[path.extname(abs)]||'application/octet-stream'});res.end(data);
  });
});

// ── WS Proxy ──────────────────────────────────────────────────────────────────
const wss=new WebSocketServer({server,path:'/v4/websocket'});
wss.on('connection',(clientWs,req)=>{
  const nodeId=req.headers['x-lm-node']||NODES[0].id;
  const idx=Math.max(0,NODES.findIndex(n=>n.id===nodeId));
  const n=NODES[idx],st=nodeState[idx];
  let tempId=`ws-${Date.now()}`,realId=tempId;
  const llWs=new WebSocket(nodeWsUrl(n),{headers:{Authorization:n.password,'User-Id':req.headers['user-id']||'2','Client-Name':req.headers['client-name']||'LavalinkMonitor/2.0',...(req.headers['session-resume-key']?{'Session-Resume-Key':req.headers['session-resume-key']}:{})}});
  st.wsProxyData.set(tempId,new Map());
  llWs.on('message',raw=>{
    try{
      const msg=JSON.parse(raw.toString());
      if(msg.op==='ready'&&msg.sessionId){const old=realId;realId=msg.sessionId;const e=st.wsProxyData.get(old)||new Map();st.wsProxyData.delete(old);st.wsProxyData.set(realId,e);st.sessionIds.add(realId);pollNodePlayers(idx);}
      const g=st.wsProxyData.get(realId)||new Map();
      if(msg.type==='TrackStartEvent'){const p=g.get(msg.guildId)||{};g.set(msg.guildId,{...p,track:msg.track,paused:false});}
      if(msg.type==='TrackEndEvent'){const p=g.get(msg.guildId)||{};g.set(msg.guildId,{...p,track:null});}
      if(msg.op==='playerUpdate'){const p=g.get(msg.guildId)||{};g.set(msg.guildId,{...p,state:msg.state});}
      st.wsProxyData.set(realId,g);
    }catch{}
    if(clientWs.readyState===WebSocket.OPEN)clientWs.send(raw);
  });
  clientWs.on('message',raw=>{if(llWs.readyState===WebSocket.OPEN)llWs.send(raw);});
  clientWs.on('close',()=>{llWs.close();st.wsProxyData.delete(realId);});
  llWs.on('close',()=>{if(clientWs.readyState===WebSocket.OPEN)clientWs.close();});
  llWs.on('error',e=>console.error('[WS LL]',e.message));
  clientWs.on('error',e=>console.error('[WS CL]',e.message));
});

server.listen(PORT,()=>console.log(`\n  ▶  Lavalink Monitor  →  http://localhost:${PORT}\n`));
