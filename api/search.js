const NODES = [
  { id:'node1', name:'Main Node',   host:'5.39.63.207',        port:9261,  password:'glace', secure:false },
  { id:'node2', name:'Wally Node',  host:'wally.hidecloud.com', port:24620, password:'glace', secure:false },
];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const url    = new URL(req.url, 'http://localhost');
  const q      = (url.searchParams.get('q') || '').trim();
  const source = url.searchParams.get('source') || 'yt';

  if (!q) { res.status(200).json({ ok:true, tracks:[] }); return; }

  // Use first online node
  const n = NODES[0];
  const base = `${n.secure?'https':'http'}://${n.host}:${n.port}`;

  let identifiers = /^https?:\/\//.test(q) ? [q]
    : source==='sc'  ? [`scsearch:${q}`]
    : source==='all' ? [`ytsearch:${q}`, `scsearch:${q}`]
    : [`ytsearch:${q}`];

  try {
    const results = await Promise.all(identifiers.map(async id => {
      const r = await fetch(`${base}/v4/loadtracks?identifier=${encodeURIComponent(id)}`, {
        headers: { Authorization: n.password }, signal: AbortSignal.timeout(12000),
      });
      if (!r.ok) return [];
      const d = await r.json();
      return Array.isArray(d.data) ? d.data : [];
    }));
    const all = [];
    if (identifiers.length > 1) {
      const mx = Math.max(...results.map(r => r.length));
      for (let i=0; i<mx; i++) results.forEach(r => { if(r[i]) all.push(r[i]); });
    } else all.push(...(results[0]||[]));
    res.status(200).json({ ok:true, tracks: all.slice(0,30) });
  } catch(e) { res.status(503).json({ ok:false, error: e.message }); }
};
