import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { writeJsonAtomic } from './atomicWrite.js';
import { evaluateItem } from './filters.js';
import { extractChaptersFromDescription } from './chapters.js';

// Builds the reader-facing artefacts from ranked channels + their fetched
// recent items. Split so the reader can load the summary quickly and fetch
// per-channel detail on demand, per the brief.
export async function buildIndexArtifacts({ indexDir, rankedChannels, itemsByChannel, filtersConfig, excludedItemIds, log }) {
  const generatedAt = new Date().toISOString();
  await mkdir(path.join(indexDir, 'channel'), { recursive: true });

  const summaryChannels = [];
  const graphNodes = new Map(); // id -> {id, kind, label}
  const graphEdges = [];

  for (const ch of rankedChannels) {
    const rawItems = itemsByChannel.get(ch.id) || [];
    const filteredItems = [];
    for (const item of rawItems) {
      const verdict = evaluateItem(item, filtersConfig, excludedItemIds);
      if (!verdict.allowed) continue;
      filteredItems.push({
        id: item.id,
        title: item.title,
        publishedAt: item.publishedAt,
        durationSec: item.durationSec,
        thumb: item.thumb,
        description: item.description.slice(0, 4000),
        chapters: extractChaptersFromDescription(item.description),
      });
    }

    summaryChannels.push({
      id: ch.id,
      title: ch.title,
      thumb: ch.thumb,
      score: ch.score,
      distinctSourceCount: ch.distinctSourceCount,
      hop: ch.hop,
      uploadsPerDay: Math.round((ch.uploadsPerDay || 0) * 100) / 100,
      recentItemCount: filteredItems.length,
    });

    const sources = Object.entries(ch.sources).map(([sourceId, meta]) => ({ id: sourceId, ...meta }));

    await writeJsonAtomic(path.join(indexDir, 'channel', `${ch.id}.v1.json`), {
      schemaVersion: 1,
      generatedAt,
      id: ch.id,
      title: ch.title,
      thumb: ch.thumb,
      score: ch.score,
      distinctSourceCount: ch.distinctSourceCount,
      hop: ch.hop,
      uploadsPerDay: Math.round((ch.uploadsPerDay || 0) * 100) / 100,
      sources,
      recentItems: filteredItems,
    });

    // Graph nodes/edges: this channel, its sources, and any channel-feature
    // edges pointing at other output-eligible channels.
    graphNodes.set(`channel:${ch.id}`, { id: `channel:${ch.id}`, kind: 'channel', label: ch.title, channelId: ch.id });
    for (const s of sources) {
      graphNodes.set(s.id, { id: s.id, kind: 'source', label: s.label || s.id, sourceType: s.type, url: s.url });
      graphEdges.push({ from: s.id, to: `channel:${ch.id}`, kind: s.type === 'wikipedia' ? 'wiki-mention' : 'channel-feature' });
    }
  }

  // channel-feature edges between two output-eligible channels (channel A's
  // sections featured channel B) are already captured above via B's
  // sources map when B's source type is 'channel'.

  await writeJsonAtomic(path.join(indexDir, 'summary.v1.json'), {
    schemaVersion: 1,
    generatedAt,
    channels: summaryChannels,
  });

  await writeJsonAtomic(path.join(indexDir, 'edges.v1.json'), {
    schemaVersion: 1,
    generatedAt,
    nodes: [...graphNodes.values()],
    edges: graphEdges,
  });

  log(`Wrote index: ${summaryChannels.length} channels, ${graphEdges.length} edges.`);
}
