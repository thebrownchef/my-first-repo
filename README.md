# my-first-repo

## Signal — a browser-only YouTube browser

`youtube-browser.html` is a single-file, no-build web app for browsing YouTube without the
recommendation algorithm. Everything runs client-side (IndexedDB for storage), so it works
on a locked-down work laptop — just open the file in a browser.

**Setup:** create a free API key in the Google Cloud Console with "YouTube Data API v3"
enabled, then paste it into the app's Settings tab. The key is stored only in your browser's
IndexedDB.

**Features:**
- No algorithmic mixing — you add specific channels, nothing is suggested to you
- Hard filters: hides Shorts (<60s), livestreams, and anything over a configurable max length
  (tries each channel's no-Shorts `UULF…` uploads feed first)
- Per-channel weighting so a channel you only half-follow doesn't dominate the feed
- Watched/dismissed state persisted in IndexedDB, plus a real "never show this channel again"
- Keyword and regex blocklists on titles
- Full-text search over the titles and descriptions of every video you've ever ingested
- Upload-frequency filter to catch content mills / mass-produced (often AI-generated) channels —
  hide anything from a channel averaging more than N uploads/day — plus a one-click preset of
  common clickbait/slop title phrases for the keyword blocklist
- Queue-based viewing instead of autoplay
- Best-effort transcript skimming (via YouTube's public timedtext endpoint, when available)
  so you can decide in seconds whether a long video is worth your time

**Limitations:** it's a static page with no server, so ingestion is rate-limited by the
YouTube Data API's free daily quota, and transcript fetching can be blocked by CORS on some
videos — there's no server-side proxy to work around that.