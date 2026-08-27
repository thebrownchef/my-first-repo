// Best-effort chapter extraction from a video's own description — the only
// per-item signal beyond title/duration/thumbnail that's derivable without
// playback and without a transcript (which is treated as unavailable per
// the timedtext PO-token block).

const LINE_RE = /^\s*(?:\[)?(\d{1,2}:)?(\d{1,2}):(\d{2})(?:\])?\s*[-–—:|]?\s*(.+?)\s*$/;

export function extractChaptersFromDescription(description) {
  if (!description) return [];
  const chapters = [];
  for (const rawLine of description.split('\n')) {
    const m = LINE_RE.exec(rawLine);
    if (!m) continue;
    const hours = m[1] ? parseInt(m[1], 10) : 0;
    const minutes = parseInt(m[2], 10);
    const seconds = parseInt(m[3], 10);
    const label = m[4].trim();
    if (!label) continue;
    const totalSeconds = hours * 3600 + minutes * 60 + seconds;
    chapters.push({ seconds: totalSeconds, label });
  }
  // A handful of stray timestamp-looking lines isn't a chapter list; require
  // at least two and that they're non-decreasing, otherwise treat as none.
  if (chapters.length < 2) return [];
  for (let i = 1; i < chapters.length; i++) {
    if (chapters[i].seconds < chapters[i - 1].seconds) return [];
  }
  return chapters;
}
