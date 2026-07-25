const NODES = [
  { id:'node1', name:'Main Node',   host:'5.39.63.207',        port:9261,  password:'glace', secure:false },
  { id:'node2', name:'Wally Node',  host:'wally.hidecloud.com', port:24620, password:'glace', secure:false },
];

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const allPlayers = [];

  await Promise.allSettled(NODES.map(async n => {
    const base = `${n.secure?'https':'http'}://${n.host}:${n.port}`;
    // First fetch the session list if available
    try {
      // Try to get players from all sessions by hitting stats then sessions
      // Sessions come from WS proxy auto-capture on Replit; on Vercel we have no WS
      // So players will only show if bot routes WS through this monitor
    } catch {}
  }));

  res.status(200).json({ ok:true, players: allPlayers, sessionCount: 0 });
};
