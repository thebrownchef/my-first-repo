// Seeding source: MediaWiki's list=exturlusage against English Wikipedia,
// enumerating article-namespace pages that link to a given external domain.
// No authentication required; a descriptive User-Agent is set per Wikimedia's
// API etiquette. Continuation state is passed in and returned so the caller
// can persist it between runs.

export async function fetchExturlusagePage({ apiEndpoint, userAgent, query, eulimit, cursor }) {
  const params = new URLSearchParams({
    action: 'query',
    list: 'exturlusage',
    euquery: query,
    eunamespace: '0',
    eulimit: String(eulimit),
    euprop: 'title|url',
    format: 'json',
  });
  if (cursor) {
    for (const [k, v] of Object.entries(cursor)) params.set(k, v);
  }
  const res = await fetch(`${apiEndpoint}?${params.toString()}`, {
    headers: { 'User-Agent': userAgent },
  });
  if (!res.ok) {
    throw new Error(`Wikipedia exturlusage failed: ${res.status} ${await res.text().catch(() => '')}`);
  }
  const data = await res.json();
  const pages = (data.query?.exturlusage || []).map((p) => ({ title: p.title, url: p.url }));
  const nextCursor = data.continue || null;
  return { pages, nextCursor, exhausted: !nextCursor };
}
