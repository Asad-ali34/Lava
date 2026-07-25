module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');

  const url      = new URL(req.url, 'http://localhost');
  const title    = url.searchParams.get('title')    || '';
  const artist   = url.searchParams.get('artist')   || '';
  const duration = url.searchParams.get('duration') || '';

  try {
    const qs = new URLSearchParams({
      track_name:  title, artist_name: artist,
      ...(duration ? { duration: Math.floor(+duration/1000) } : {}),
    });
    const r = await fetch(`https://lrclib.net/api/get?${qs}`, {
      headers: { 'Lrclib-Client': 'LavalinkMonitor/2.0' },
      signal:  AbortSignal.timeout(6000),
    });
    if (r.status===404) { res.status(200).json({ ok:true, lyrics:null }); return; }
    if (!r.ok) throw new Error(`LRCLib ${r.status}`);
    const d = await r.json();
    res.status(200).json({
      ok:true, lyrics:d.plainLyrics||null,
      syncedLyrics:d.syncedLyrics||null,
      hasLyrics:!!(d.plainLyrics||d.syncedLyrics),
    });
  } catch { res.status(200).json({ ok:true, lyrics:null }); }
};
