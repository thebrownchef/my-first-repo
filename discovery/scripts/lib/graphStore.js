// The canonical, cumulative crawl state (discovery/data/state/graph.json).
// This is internal to the job — the reader never reads it directly, only the
// derived data/index/*.json artefacts built from it each run.

export function upsertChannel(graph, channelInfo, hop) {
  const existing = graph.channels[channelInfo.id];
  graph.channels[channelInfo.id] = {
    ...channelInfo,
    hop: existing ? Math.min(existing.hop, hop) : hop,
    sources: existing?.sources || {},
    sectionsChecked: existing?.sectionsChecked || false,
    firstSeenAt: existing?.firstSeenAt || new Date().toISOString(),
    lastUpdatedAt: new Date().toISOString(),
  };
  return graph.channels[channelInfo.id];
}

export function addSource(graph, channelId, sourceId, sourceMeta) {
  const ch = graph.channels[channelId];
  if (!ch) return;
  if (!ch.sources[sourceId]) {
    ch.sources[sourceId] = { ...sourceMeta, firstSeenAt: new Date().toISOString() };
  }
}

export function addEdge(graph, from, to, kind) {
  const exists = graph.edges.some((e) => e.from === from && e.to === to && e.kind === kind);
  if (!exists) {
    graph.edges.push({ from, to, kind, at: new Date().toISOString() });
  }
}

export function emptyGraph() {
  return { schemaVersion: 1, generatedAt: null, channels: {}, edges: [] };
}
