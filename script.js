'use strict';

// ════════════════════════════════════════════════════════════════════════════
// ── LAVALINK CONFIG  (edit these to match your server) ──────────────────────
// ════════════════════════════════════════════════════════════════════════════
const LAVALINK_NODES = [
  { id:'node1', name:'Main Node',  host:'5.39.63.207',        port:9261,  password:'glace', secure:false },
  { id:'node2', name:'Wally Node', host:'wally.hidecloud.com', port:24620, password:'glace', secure:false },
];
// ↑ Add or remove nodes here. The monitor shows all of them automatically.
// ════════════════════════════════════════════════════════════════════════════
// ── MONITOR CONFIG (tweak refresh rates, chart window, etc.) ────────────────
const CFG = {
  REFRESH_NODES:   4000,   // ms — poll all node stats
  REFRESH_PLAYERS: 3000,   // ms — poll now-playing data
  HIST_MAX:        80,     // chart data points to keep
  HIST_KEY:        'lm-v8',
  OVERLAY_TIMEOUT: 1200,   // ms — force-hide overlay even if no response
};
// ════════════════════════════════════════════════════════════════════════════

// ── Chart history ──────────────────────────────────────────────────────────
const H = { ts:[], cpu:[], cpuLL:[], mem:[], total:[], playing:[], ping:[] };
(function loadHist() {
  try {
    const d = JSON.parse(localStorage.getItem(CFG.HIST_KEY)||'null');
    if (!d || !Array.isArray(d.ts) || !d.ts.length) return;
    if (Date.now() - (d._t||0) > 4*3600_000) return;
    Object.keys(H).forEach(k => { if (Array.isArray(d[k])) H[k] = d[k]; });
  } catch {}
})();
function saveHist() {
  try { localStorage.setItem(CFG.HIST_KEY, JSON.stringify({...H, _t:Date.now()})); } catch {}
}

// ── Helpers ────────────────────────────────────────────────────────────────
const $   = id => document.getElementById(id);
const set = (id, v) => { const e=$(id); if(e) e.textContent=v; };
const esc = s => String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const fmtMB  = b => b==null?'—':`${(b/1048576).toFixed(1)} MB`;
const fmtPct = v => v==null?'—':`${(v*100).toFixed(1)}%`;
const fmtNum = n => n==null?'—':String(n);
const tNow   = () => new Date().toLocaleTimeString('en',{hour12:false,hour:'2-digit',minute:'2-digit',second:'2-digit'});
function fmtDur(ms) {
  if (ms==null||ms<0) return '—';
  const s=Math.floor(ms/1000),d=Math.floor(s/86400),h=Math.floor((s%86400)/3600),m=Math.floor((s%3600)/60),sec=s%60;
  if(d) return `${d}d ${h}h ${m}m`; if(h) return `${h}h ${m}m`; if(m) return `${m}m ${sec}s`; return `${sec}s`;
}
function fmtTime(ms) {
  if (!ms||ms<0) return '0:00';
  const s=Math.floor(ms/1000),m=Math.floor(s/60),h=Math.floor(m/60),p=n=>String(n).padStart(2,'0');
  return h?`${h}:${p(m%60)}:${p(s%60)}`:`${m}:${p(s%60)}`;
}

// ── Loading overlay ────────────────────────────────────────────────────────
let _loaded = false;
function hideOverlay() {
  if (_loaded) return; _loaded = true;
  const o=$('loadOverlay'); if(o){o.classList.add('out'); setTimeout(()=>o.remove(),650);}
}
set('loadMsg','Connecting to Lavalink…');
// Force-hide after timeout even if request is slow
setTimeout(hideOverlay, CFG.OVERLAY_TIMEOUT);

// ── Status ─────────────────────────────────────────────────────────────────
function setOnline(ok) {
  const p=$('statusPill'); if(!p) return;
  p.className=`status-pill ${ok?'online':'offline'}`;
  set('statusText', ok?'Online':'Offline');
}

// ── Node pills & cards ─────────────────────────────────────────────────────
let _nodes = [], _activeNode = 0;

function renderNodePills(nodes) {
  const wrap=$('nodePills'); if(!wrap) return;
  wrap.innerHTML = nodes.map((n,i)=>`
    <div class="node-pill ${n.online?'online':'offline'} ${i===_activeNode?'active':''}" data-idx="${i}">
      <div class="node-pill-dot"></div>
      ${esc(n.name)}
      ${n.ping!=null?`<span class="hdr-unit">${n.ping}ms</span>`:''}
    </div>`).join('');
  wrap.querySelectorAll('.node-pill').forEach(el=>{
    el.addEventListener('click',()=>{ _activeNode=+el.dataset.idx; renderNodePills(_nodes); renderStatCards(_nodes[_activeNode]); });
  });

  // Show multi-node overview cards only if >1 node
  const nc=$('nodeCards');
  if (nc) {
    if (nodes.length > 1) {
      nc.style.display='';
      nc.innerHTML = nodes.map((n,i)=>`
        <div class="nc ${i===_activeNode?'active':''}" data-idx="${i}">
          <div class="nc-dot ${n.online?'nc-dot-on':'nc-dot-off'}"></div>
          <div class="nc-info">
            <div class="nc-name">${esc(n.name)}</div>
            <div class="nc-sub">${esc(n.host)}:${n.port}</div>
          </div>
          <div class="nc-ping">${n.online?(n.ping+'ms'):'offline'}</div>
        </div>`).join('');
      nc.querySelectorAll('.nc').forEach(el=>{
        el.addEventListener('click',()=>{ _activeNode=+el.dataset.idx; renderNodePills(_nodes); renderStatCards(_nodes[_activeNode]); nc.querySelectorAll('.nc').forEach((c,ci)=>c.classList.toggle('active',ci===_activeNode)); });
      });
    } else nc.style.display='none';
  }
}

// ── Gauges ─────────────────────────────────────────────────────────────────
function drawGauge(id, pct, color) {
  const el=$(id); if(!el) return;
  const ctx=el.getContext('2d'),w=el.width,h=el.height,cx=w/2,cy=h,r=h-10,lw=8;
  ctx.clearRect(0,0,w,h);
  ctx.beginPath();ctx.arc(cx,cy,r,Math.PI,0);ctx.strokeStyle='rgba(255,255,255,.06)';ctx.lineWidth=lw;ctx.lineCap='round';ctx.stroke();
  if(pct>0){
    const end=Math.PI+Math.PI*Math.min(pct,1);
    ctx.beginPath();ctx.arc(cx,cy,r,Math.PI,end);ctx.strokeStyle=color;ctx.shadowColor=color;ctx.shadowBlur=12;ctx.lineWidth=lw;ctx.lineCap='round';ctx.stroke();ctx.shadowBlur=0;
    const ex=cx+r*Math.cos(end),ey=cy+r*Math.sin(end);
    ctx.beginPath();ctx.arc(ex,ey,lw/2+1.5,0,2*Math.PI);ctx.fillStyle=color;ctx.shadowColor=color;ctx.shadowBlur=8;ctx.fill();ctx.shadowBlur=0;
  }
}

// ── Charts ─────────────────────────────────────────────────────────────────
Chart.defaults.color='rgba(123,143,187,.6)';
Chart.defaults.font={family:'"Inter","Segoe UI",system-ui,sans-serif',size:10};

function mkG(ctx,c1,c2){const g=ctx.createLinearGradient(0,0,0,150);g.addColorStop(0,c1);g.addColorStop(1,c2);return g;}

const COPTS={
  responsive:true,maintainAspectRatio:false,animation:{duration:400},
  interaction:{mode:'index',intersect:false},
  plugins:{
    legend:{position:'top',labels:{boxWidth:7,usePointStyle:true,pointStyle:'circle',padding:14,color:'#384260'}},
    tooltip:{backgroundColor:'rgba(5,9,22,.97)',borderColor:'rgba(99,102,241,.22)',borderWidth:1,padding:10,cornerRadius:10,titleColor:'#7b8fbb',bodyColor:'#edf2ff',displayColors:true,boxWidth:8,boxHeight:8},
  },
  scales:{
    x:{grid:{color:'rgba(255,255,255,.022)',drawTicks:false},ticks:{maxTicksLimit:5,color:'#233050',padding:4}},
    y:{grid:{color:'rgba(255,255,255,.022)',drawTicks:false},ticks:{maxTicksLimit:5,color:'#233050',padding:4},beginAtZero:true},
  },
};

function ds(label,border,bgFn,data){
  return{label,data,borderColor:border,backgroundColor:bgFn,borderWidth:2.5,fill:true,tension:.45,pointRadius:0,pointHoverRadius:6,pointHoverBackgroundColor:border,pointHoverBorderColor:'rgba(3,8,18,.8)',pointHoverBorderWidth:2};
}

const cpuChart=new Chart($('cpuChart').getContext('2d'),{
  type:'line',
  data:{labels:[...H.ts],datasets:[
    ds('System %','#818cf8',ctx=>mkG(ctx.chart.ctx,'rgba(129,140,248,.25)','rgba(129,140,248,.01)'),[...H.cpu]),
    ds('Lavalink %','#22d3ee',ctx=>mkG(ctx.chart.ctx,'rgba(34,211,238,.2)','rgba(34,211,238,.01)'),[...H.cpuLL]),
  ]},
  options:{...COPTS,scales:{...COPTS.scales,y:{...COPTS.scales.y,max:100,ticks:{...COPTS.scales.y.ticks,callback:v=>v+'%'}}}}
});
const memChart=new Chart($('memChart').getContext('2d'),{
  type:'line',
  data:{labels:[...H.ts],datasets:[ds('Used MB','#34d399',ctx=>mkG(ctx.chart.ctx,'rgba(52,211,153,.22)','rgba(52,211,153,.01)'),[...H.mem])]},
  options:{...COPTS,plugins:{...COPTS.plugins,legend:{display:false}},scales:{...COPTS.scales,y:{...COPTS.scales.y,ticks:{...COPTS.scales.y.ticks,callback:v=>v+' MB'}}}}
});
const playChart=new Chart($('playersChart').getContext('2d'),{
  type:'line',
  data:{labels:[...H.ts],datasets:[
    ds('Total','#818cf8',ctx=>mkG(ctx.chart.ctx,'rgba(129,140,248,.2)','rgba(129,140,248,.01)'),[...H.total]),
    ds('Playing','#f472b6',ctx=>mkG(ctx.chart.ctx,'rgba(244,114,182,.2)','rgba(244,114,182,.01)'),[...H.playing]),
  ]},
  options:{...COPTS,scales:{...COPTS.scales,y:{...COPTS.scales.y,ticks:{...COPTS.scales.y.ticks,precision:0}}}}
});
const pingChart=new Chart($('pingChart').getContext('2d'),{
  type:'line',
  data:{labels:[...H.ts],datasets:[ds('Ping ms','#06b6d4',ctx=>mkG(ctx.chart.ctx,'rgba(6,182,212,.22)','rgba(6,182,212,.01)'),[...H.ping])]},
  options:{...COPTS,plugins:{...COPTS.plugins,legend:{display:false}},scales:{...COPTS.scales,y:{...COPTS.scales.y,ticks:{...COPTS.scales.y.ticks,callback:v=>v+'ms'}}}}
});

function pushHist(ts,cpu,cpuLL,mem,total,playing,ping){
  H.ts.push(ts);H.cpu.push(cpu);H.cpuLL.push(cpuLL);H.mem.push(mem);H.total.push(total);H.playing.push(playing);H.ping.push(ping);
  Object.keys(H).forEach(k=>{if(H[k].length>CFG.HIST_MAX)H[k].shift();});
  cpuChart.data.labels=H.ts;cpuChart.data.datasets[0].data=H.cpu;cpuChart.data.datasets[1].data=H.cpuLL;cpuChart.update('none');
  memChart.data.labels=H.ts;memChart.data.datasets[0].data=H.mem;memChart.update('none');
  playChart.data.labels=H.ts;playChart.data.datasets[0].data=H.total;playChart.data.datasets[1].data=H.playing;playChart.update('none');
  pingChart.data.labels=H.ts;pingChart.data.datasets[0].data=H.ping;pingChart.update('none');
  saveHist();
}

// ── Stat cards render ──────────────────────────────────────────────────────
function renderStatCards(node) {
  if (!node || !node.online || !node.stats) {
    ['uptime','totalPlayers','playingPlayers','cpuLLCard','memCard','cpuCores'].forEach(id=>set(id,'—'));
    return;
  }
  const d=node.stats, cpu=d.cpu||{}, mem=d.memory||{};
  set('uptime',         fmtDur(d.uptime));
  set('totalPlayers',   fmtNum(d.players));
  set('playingPlayers', fmtNum(d.playingPlayers));
  set('cpuCores',       fmtNum(cpu.cores));
  set('cpuLLCard',      fmtPct(cpu.lavalinkLoad));
  set('memCard',        fmtMB(mem.used));

  const sys=cpu.systemLoad??0, ll=cpu.lavalinkLoad??0;
  set('gSysVal',fmtPct(sys)); drawGauge('gaugeSys',sys,'#818cf8');
  set('gLLVal', fmtPct(ll));  drawGauge('gaugeLL', ll, '#22d3ee');
  set('cpuSys', fmtPct(sys)); $('bSys').style.width=`${Math.min(sys*100,100).toFixed(1)}%`;
  set('cpuLL',  fmtPct(ll));  $('bLL').style.width =`${Math.min(ll*100,100).toFixed(1)}%`;

  const used=mem.used||0, alloc=mem.allocated||1;
  set('memUsed',fmtMB(used)); $('bMem').style.width=`${Math.min((used/alloc)*100,100).toFixed(1)}%`;
  set('memAlloc',fmtMB(mem.allocated));set('memRes',fmtMB(mem.reservable));set('memFree',fmtMB(mem.free));

  const fr=d.frameStats,ft=$('frameTiles'),fn=$('frameNone');
  if(fr&&fr.sent>0){if(ft)ft.style.display='flex';if(fn)fn.style.display='none';set('fSent',fmtNum(fr.sent));set('fNull',fmtNum(fr.nulled));set('fDef',fmtNum(fr.deficit));}
  else{if(ft)ft.style.display='none';if(fn)fn.style.display='flex';}

  const now=tNow();
  set('lastUpdated',now); set('footerTime',now);
  set('hdrUptime',fmtDur(d.uptime));
  set('hdrPlayers',d.players??'--');

  ['sc0','sc1','sc2','sc3','sc4','sc5'].forEach(id=>{
    const e=$(id);if(!e)return;e.classList.remove('flash');void e.offsetWidth;e.classList.add('flash');
  });

  pushHist(now,+(sys*100).toFixed(1),+(ll*100).toFixed(1),+((used/1048576).toFixed(1)),
    d.players??0,d.playingPlayers??0,node.ping??0);
}

// ── Progress bar ───────────────────────────────────────────────────────────
function startProgress(){
  const b=$('progFill');if(!b)return;
  b.style.transition='none';b.style.width='0%';void b.offsetWidth;
  b.style.transition=`width ${CFG.REFRESH_NODES}ms linear`;b.style.width='100%';
}

// ── Fetch all nodes ────────────────────────────────────────────────────────
async function fetchNodes() {
  try {
    const r=await fetch('/api/nodes',{signal:AbortSignal.timeout(8000)});
    if(!r.ok) throw new Error(`HTTP ${r.status}`);
    const j=await r.json();
    if(!j.ok) throw new Error(j.error||'Error');
    _nodes=j.nodes||[];

    const anyOnline=_nodes.some(n=>n.online);
    setOnline(anyOnline);
    if(anyOnline) { hideOverlay(); startProgress(); }

    // footer
    const online=_nodes.filter(n=>n.online).length;
    set('footerNodes',`${online}/${_nodes.length} node${_nodes.length>1?'s':''} online`);

    // Active node ping in header
    const an=_nodes[_activeNode];
    if(an) { set('hdrPing', an.ping??'--'); }

    renderNodePills(_nodes);
    const activeNode=_nodes[_activeNode]||_nodes[0];
    if(activeNode) renderStatCards(activeNode);

  } catch(e) {
    setOnline(false);
    set('loadMsg',`Error: ${e.message}`);
  }
}

// ── Now Playing ────────────────────────────────────────────────────────────
async function fetchPlayers() {
  try {
    const r=await fetch('/api/players?node=all',{signal:AbortSignal.timeout(6000)});
    const j=await r.json();
    if(j.ok) renderPlayers(j.players||[]);
  } catch {}
}

function renderPlayers(players) {
  const grid=$('npGrid'), badge=$('npCount'); if(!grid) return;
  const active=players.filter(p=>p.track);
  if(badge) badge.textContent=active.length;

  if(!active.length) {
    const an=_nodes[_activeNode];
    const hint=an&&an.stats?`${an.stats.players||0} players connected on ${an.name} — ` :'';
    grid.innerHTML=`<div class="np-empty"><div class="np-eq"><span></span><span></span><span></span><span></span><span></span></div><p>No track data yet</p><span id="npEmptyHint">${esc(hint)}Monitor auto-connects and captures session IDs. Track info shows here once a bot plays music through the WS proxy.</span></div>`;
    return;
  }
  grid.innerHTML=active.map(npCard).join('');
}

function npCard(p) {
  const t=p.track?.info||{},pos=p.state?.position??0,dur=t.length??0,pct=dur>0?Math.min((pos/dur)*100,100):0;
  return `
<div class="np-card">
  <div class="np-art">
    ${t.artworkUrl?`<img src="${esc(t.artworkUrl)}" alt="" loading="lazy"/>`:
    `<div class="np-art-ph"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>`}
    ${!p.paused?'<div class="np-anim"><span></span><span></span><span></span></div>':''}
  </div>
  <div class="np-info">
    <div class="np-title">${esc(t.title||'Unknown Track')}</div>
    <div class="np-author">${esc(t.author||'')}</div>
    ${!t.isStream?`<div class="np-prog"><span class="np-ts">${fmtTime(pos)}</span><div class="np-bw"><div class="np-bf" style="width:${pct.toFixed(2)}%"></div></div><span class="np-ts">${dur>0?fmtTime(dur):'∞'}</span></div>`
    :`<div class="np-prog"><span class="np-ts" style="color:var(--rose);font-weight:700">● LIVE</span></div>`}
  </div>
  <div class="np-meta">
    ${p.nodeName?`<span class="np-node">${esc(p.nodeName)}</span>`:''}
    <span class="np-badge ${p.paused?'nb-pause':'nb-play'}">${p.paused?'Paused':'Playing'}</span>
  </div>
</div>`;
}

$('npHelpBtn')?.addEventListener('click',()=>{ const b=$('npHelp');if(b)b.style.display=b.style.display==='none'?'':'none'; });
$('npHelpClose')?.addEventListener('click',()=>{ const b=$('npHelp');if(b)b.style.display='none'; });

// ── Source toggle ──────────────────────────────────────────────────────────
let activeSource='yt';
document.querySelectorAll('.src-btn').forEach(btn=>{
  btn.addEventListener('click',()=>{
    document.querySelectorAll('.src-btn').forEach(b=>b.classList.remove('active'));
    btn.classList.add('active'); activeSource=btn.dataset.src;
    const q=($('searchInput')?.value||'').trim();
    if(q){showSpinner(true);clearTimeout(_st);_st=setTimeout(()=>doSearch(q),200);}
  });
});

// ── Trending chips ─────────────────────────────────────────────────────────
document.querySelectorAll('.chip').forEach(c=>{
  c.addEventListener('click',()=>{
    const q=c.dataset.q;
    const inp=$('searchInput');if(!inp)return;
    inp.value=q;
    $('searchClear').style.display='flex';
    const tw=$('trendingWrap');if(tw)tw.style.display='none';
    showSpinner(true);clearTimeout(_st);_st=setTimeout(()=>doSearch(q),200);
    inp.focus();
  });
});

// ── Search ─────────────────────────────────────────────────────────────────
let _st=null, _activeCard=null;

$('searchInput')?.addEventListener('input',e=>{
  const q=(e.target.value||'').trim();
  $('searchClear').style.display=q?'flex':'none';
  const tw=$('trendingWrap');if(tw)tw.style.display=q?'none':'';
  clearTimeout(_st);
  if(!q){closePlayer();renderHint();return;}
  showSpinner(true);_st=setTimeout(()=>doSearch(q),400);
});
$('searchClear')?.addEventListener('click',()=>{
  $('searchInput').value='';$('searchClear').style.display='none';
  const tw=$('trendingWrap');if(tw)tw.style.display='';
  closePlayer();renderHint();$('searchInput').focus();
});

function renderHint(){$('searchResults').innerHTML=`<div class="search-hint"><svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="28" cy="28" r="20"/><line x1="52" y1="52" x2="41" y2="41"/></svg><p>Search any song</p><span>YouTube &amp; SoundCloud — plays right here, no redirects</span></div>`;}
function showSpinner(s){const sp=$('searchSpinner'),cl=$('searchClear');if(sp)sp.style.display=s?'flex':'none';if(cl&&!s)cl.style.display=($('searchInput')?.value||'').trim()?'flex':'none';}

async function doSearch(q) {
  const res=$('searchResults');if(!res)return;
  try {
    const r=await fetch(`/api/search?q=${encodeURIComponent(q)}&source=${activeSource}`);
    const j=await r.json();
    showSpinner(false);
    if(!j.ok){res.innerHTML=`<div class="search-state err">⚠ ${esc(j.error||'Search failed')}</div>`;return;}
    const tracks=j.tracks||[];
    if(!tracks.length){res.innerHTML=`<div class="search-state">No results for "<em>${esc(q)}</em>"</div>`;return;}
    res.innerHTML=`<div class="sr-list">${tracks.slice(0,30).map((t,i)=>srCard(t,i)).join('')}</div>`;
    res.querySelectorAll('.sr-card').forEach((el,i)=>el.addEventListener('click',ev=>{ev.preventDefault();openPlayer(tracks[i],el);}));
  } catch(e){showSpinner(false);res.innerHTML=`<div class="search-state err">⚠ ${esc(e.message)}</div>`;}
}

function srcInfo(info){
  const s=(info.sourceName||'').toLowerCase(),u=(info.uri||'').toLowerCase();
  if(s==='youtube'||u.includes('youtu'))return{label:'YT',cls:'sr-src-yt'};
  if(s==='soundcloud'||u.includes('soundcloud'))return{label:'SC',cls:'sr-src-sc'};
  return{label:(s||'?').toUpperCase().slice(0,3),cls:'sr-src-other'};
}

function srCard(t,i){
  const info=t.info||{},art=info.artworkUrl,dur=info.isStream?'LIVE':fmtTime(info.length),si=srcInfo(info),delay=Math.min(i*.03,.5);
  return`<div class="sr-card" style="animation-delay:${delay}s"><span class="sr-num">${i+1}</span><div class="sr-art">${art?`<img src="${esc(art)}" alt="" loading="lazy"/>`:`<div class="sr-art-ph"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg></div>`}</div><div class="sr-body"><div class="sr-title">${esc(info.title||'Unknown')}</div><div class="sr-author">${esc(info.author||'')}</div></div><div class="sr-right"><span class="sr-src ${si.cls}">${si.label}</span><span class="sr-dur ${info.isStream?'sr-live':''}">${esc(dur)}</span><div class="sr-play"><svg viewBox="0 0 16 16" fill="none"><polygon points="4,2 13,8 4,14" fill="currentColor"/></svg></div></div></div>`;
}

// ── YouTube ID extractor ───────────────────────────────────────────────────
function ytId(uri){if(!uri)return null;const m=uri.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([a-zA-Z0-9_-]{11})/);return m?.[1]||null;}

// ── In-page player ─────────────────────────────────────────────────────────
let _cur=null;
function openPlayer(track,cardEl){
  const info=track.info||{},panel=$('playerPanel');if(!panel)return;
  _cur=track;
  if(_activeCard)_activeCard.classList.remove('active');
  _activeCard=cardEl;if(cardEl)cardEl.classList.add('active');
  const artEl=$('playerArt');
  if(artEl){artEl.src=info.artworkUrl||'';artEl.style.display=info.artworkUrl?'':'none';}
  const si=srcInfo(info);
  const srcEl=$('playerSrc');if(srcEl){srcEl.textContent=si.label;srcEl.className=`player-src ${si.cls.replace('sr-src-','')==='yt'?'sr-src-yt':si.cls.replace('sr-src-','sc')==='sc'?'sr-src-sc':'sr-src-other'}`;}
  set('playerTitle',info.title||'Unknown Track');
  set('playerAuthor',info.author||'');
  set('playerDur',info.isStream?'🔴 Live':info.length?fmtTime(info.length):'');
  const embed=$('playerEmbed'),src=(info.sourceName||'').toLowerCase(),uri=info.uri||'';
  let html='';
  if(src==='youtube'||uri.includes('youtu')){
    const vid=ytId(uri);
    html=vid?`<iframe id="ytFrame" src="https://www.youtube.com/embed/${vid}?autoplay=1&rel=0&modestbranding=1&enablejsapi=1&origin=${encodeURIComponent(location.origin)}" allow="autoplay;encrypted-media;picture-in-picture" allowfullscreen frameborder="0" style="width:100%;height:100%;min-height:120px;border-radius:9px;background:#000;display:block;"></iframe>`:noEmbed(uri,'YouTube');
    setupYtErrHandler();
  } else if(src==='soundcloud'||uri.includes('soundcloud')){
    html=`<iframe src="https://w.soundcloud.com/player/?url=${encodeURIComponent(uri)}&auto_play=true&color=%236366f1&buying=false&liking=false&download=false&sharing=false&show_artwork=false&show_comments=false&show_playcount=false&show_user=false&hide_related=true" scrolling="no" frameborder="0" style="width:100%;height:100%;min-height:120px;border-radius:9px;display:block;"></iframe>`;
  } else html=noEmbed(uri,si.label);
  if(embed)embed.innerHTML=html;
  panel.style.display='flex';closeLyrics();
  panel.scrollIntoView({behavior:'smooth',block:'nearest'});
}
function noEmbed(uri,label){return`<div class="no-embed"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" style="width:32px;height:32px"><circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/></svg><p>Preview unavailable for ${esc(label||'this source')}</p>${uri?`<a href="${esc(uri)}" target="_blank" rel="noopener">Open on ${esc(label||'site')} ↗</a>`:''}</div>`;}
function setupYtErrHandler(){
  if(window._ytH)window.removeEventListener('message',window._ytH);
  window._ytH=e=>{
    if(!String(e.origin).includes('youtube.com'))return;
    try{const d=JSON.parse(e.data);if(d.info&&typeof d.info==='number'&&[100,101,150].includes(d.info)){const em=$('playerEmbed');if(em&&_cur)em.innerHTML=noEmbed(_cur.info?.uri||'','YouTube');}}catch{}
  };
  window.addEventListener('message',window._ytH);
}
function closePlayer(){
  const p=$('playerPanel');if(p)p.style.display='none';
  const e=$('playerEmbed');if(e)e.innerHTML='';
  if(_activeCard){_activeCard.classList.remove('active');_activeCard=null;}
  closeLyrics();_cur=null;
}
$('playerClose')?.addEventListener('click',closePlayer);

// ── Lyrics ─────────────────────────────────────────────────────────────────
let _lyrOpen=false;
$('lyricsBtn')?.addEventListener('click',()=>{if(_lyrOpen){closeLyrics();return;}if(_cur)openLyrics(_cur);});
$('lyricsClose')?.addEventListener('click',closeLyrics);
function openLyrics(track){
  const p=$('lyricsPanel'),b=$('lyricsBtn');if(!p)return;
  const info=track.info||{};
  p.style.display='';$('lyricsBody').innerHTML=`<div class="lyrics-loading"><div class="spin-ring"></div>Fetching lyrics…</div>`;
  _lyrOpen=true;if(b)b.classList.add('active');
  fetchLyrics(info.title||'',info.author||'',info.length);
}
function closeLyrics(){const p=$('lyricsPanel'),b=$('lyricsBtn');if(!p)return;p.style.display='none';_lyrOpen=false;if(b)b.classList.remove('active');}
async function fetchLyrics(title,artist,duration){
  try{
    const qs=new URLSearchParams({title,artist,duration:duration??''});
    const r=await fetch(`/api/lyrics?${qs}`);const j=await r.json();
    const body=$('lyricsBody');if(!body)return;
    if(!j.ok||!j.lyrics){body.innerHTML=`<div class="lyrics-none">No lyrics found for this track</div>`;return;}
    set('lyricsSrc','via LRCLib');
    body.innerHTML=j.lyrics.split('\n').map(l=>l.trim()?`<div class="lyrics-text">${esc(l)}</div>`:'<br/>').join('');
  }catch{const b=$('lyricsBody');if(b)b.innerHTML=`<div class="lyrics-none">Could not load lyrics</div>`;}
}

// ── Init ───────────────────────────────────────────────────────────────────
fetchNodes();
fetchPlayers();
setInterval(fetchNodes,   CFG.REFRESH_NODES);
setInterval(fetchPlayers, CFG.REFRESH_PLAYERS);
