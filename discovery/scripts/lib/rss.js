// Best-effort, zero-quota recent-uploads lookup via YouTube's public uploads
// feed. This is exactly the videos.xml endpoint the brief says the *reader*
// can never use (no CORS header) — but this module only ever runs inside the
// job (Node, not a browser), where CORS doesn't apply. It's still an
// unofficial, undocumented surface being hit from a cloud IP, so every
// failure mode here must fail soft and fall back to playlistItems.list; it
// must never throw in a way that stops the run.

export async function fetchRecentVideoIdsFromRss(channelId, maxResults) {
  try {
    const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; signal-discovery-bot/1.0)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const xml = await res.text();
    if (!xml || !xml.includes('<entry>')) return null;
    const ids = [...xml.matchAll(/<yt:videoId>([\w-]{11})<\/yt:videoId>/g)].map((m) => m[1]);
    return ids.length ? ids.slice(0, maxResults) : null;
  } catch {
    return null; // network error, timeout, blocked by rate limiting, malformed body — all treated the same: "unavailable this run"
  }
}
