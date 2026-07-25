const NODES = [
  { id:'node1', name:'Main Node',   host:'5.39.63.207',       port:9261,  password:'glace', secure:false },
  { id:'node2', name:'Wally Node',  host:'wally.hidecloud.com', port:24620, password:'glace', secure:false },
];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const results = await Promise.allSettled(NODES.map(async n => {
    const base = `${n.secure?'https':'http'}://${n.host}:${n.port}`;
    const t0 = Date.now();
    try {
      const r = await fetch(`${base}/v4/stats`, {
        headers: { Authorization: n.password },
        signal: AbortSignal.timeout(6000),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const stats = await r.json();
      return {
        id: n.id, name: n.name, host: n.host, port: n.port, secure: n.secure,
        online: true, ping: Date.now() - t0, stats,
        playerCount:  stats.players        ?? 0,
        playingCount: stats.playingPlayers ?? 0,
        sessions: [],
      };
    } catch {
      return { id:n.id, name:n.name, host:n.host, port:n.port, secure:n.secure,
        online:false, ping:null, stats:null, playerCount:0, playingCount:0, sessions:[] };
    }
  }));

  res.status(200).json({ ok:true, nodes: results.map(r => r.status==='fulfilled' ? r.value : r.reason) });
};
