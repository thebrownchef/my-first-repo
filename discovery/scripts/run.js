#!/usr/bin/env node
// Entry point for the scheduled ingestion job. Orchestrates: Wikipedia
// seeding -> channel-section expansion -> ranking -> filtered item fetch ->
// index build. Reads config/state from disk, writes state/index back to
// disk; committing those files to the repo is the calling workflow's job,
// not this script's.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readJson, writeJsonAtomic } from './lib/atomicWrite.js';
import { QuotaTracker } from './lib/quota.js';
import { makeYouTubeClient, channelFromApi, videoFromApi } from './lib/youtube.js';
import { fetchExturlusagePage } from './lib/wikipedia.js';
import { extractRefsFromWikiPages } from './lib/extractRefs.js';
import { upsertChannel, addSource, addEdge, emptyGraph } from './lib/graphStore.js';
import { loadJudgements, excludedChannelIdSet, excludedItemIdSet } from './lib/judgements.js';
import { isChannelBlocked } from './lib/filters.js';
import { rankChannels } from './lib/rank.js';
import { fetchRecentVideoIdsFromRss } from './lib/rss.js';
import { buildIndexArtifacts } from './lib/buildIndex.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PATHS = {
  filtersConfig: path.join(ROOT, 'config', 'filters.json'),
  pipelineConfig: path.join(ROOT, 'config', 'pipeline.json'),
  wikiCursor: path.join(ROOT, 'data', 'state', 'wiki-cursor.json'),
  graph: path.join(ROOT, 'data', 'state', 'graph.json'),
  judgements: path.join(ROOT, 'data', 'judgements.json'),
  indexDir: path.join(ROOT, 'data', 'index'),
};

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}
function warn(...args) {
  console.warn(new Date().toISOString(), 'WARN', ...args);
}
function errorLoud(...args) {
  console.error(new Date().toISOString(), 'ERROR', ...args);
}

async function resolveChannelRef(ref, yt) {
  if (ref.type === 'id') {
    const [item] = await yt.channelsByIds([ref.value]);
    return item ? channelFromApi(item) : null;
  }
  if (ref.type === 'handle') {
    const item = await yt.channelByHandle(ref.value);
    return item ? channelFromApi(item) : null;
  }
  if (ref.type === 'user') {
    const item = await yt.channelByUsername(ref.value);
    return item ? channelFromApi(item) : null;
  }
  return null;
}

async function main() {
  const apiKey = process.env.YOUTUBE_API_KEY;
  if (!apiKey) {
    errorLoud('YOUTUBE_API_KEY is not set. Configure it as a repository secret — see discovery/README.md.');
    process.exit(1);
  }

  const filtersConfig = await readJson(PATHS.filtersConfig);
  const pipelineConfig = await readJson(PATHS.pipelineConfig);
  const wikiCursorState = await readJson(PATHS.wikiCursor, { schemaVersion: 1, cursors: {} });
  const graph = await readJson(PATHS.graph, emptyGraph());
  const judgements = await loadJudgements(PATHS.judgements);

  const excludedChannels = excludedChannelIdSet(judgements);
  const excludedItems = excludedItemIdSet(judgements);

  const quota = new QuotaTracker(pipelineConfig.quota.dailyUnitBudget);
  const yt = makeYouTubeClient({ apiKey, quota });

  let quotaHit = false;

  // ---------- Stage 1: Wikipedia seeding ----------
  try {
    for (const query of pipelineConfig.wikipedia.queries) {
      let cursor = wikiCursorState.cursors[query] || null;
      for (let p = 0; p < pipelineConfig.wikipedia.pagesPerRunPerQuery; p++) {
        let page;
        try {
          page = await fetchExturlusagePage({
            apiEndpoint: pipelineConfig.wikipedia.apiEndpoint,
            userAgent: pipelineConfig.wikipedia.userAgent,
            query,
            eulimit: pipelineConfig.wikipedia.eulimit,
            cursor,
          });
        } catch (err) {
          warn(`Wikipedia seeding for "${query}" failed, skipping rest of this query for this run:`, err.message);
          break;
        }
        log(`Wikipedia "${query}": fetched ${page.pages.length} pages${page.exhausted ? ' (corpus exhausted, will restart next run)' : ''}.`);
        const { channelRefs, videoRefs } = extractRefsFromWikiPages(page.pages);

        // Resolve channel refs, one API call per handle/user, batched for ids.
        const idRefs = channelRefs.filter((r) => r.type === 'id');
        const otherRefs = channelRefs.filter((r) => r.type !== 'id');
        if (idRefs.length) {
          const uniqueIds = [...new Set(idRefs.map((r) => r.value))];
          const items = await yt.channelsByIds(uniqueIds);
          const byId = new Map(items.map((it) => [it.id, it]));
          for (const ref of idRefs) {
            const apiItem = byId.get(ref.value);
            if (!apiItem) continue;
            const info = channelFromApi(apiItem);
            upsertChannel(graph, info, 0);
            addSource(graph, info.id, `wiki:${ref.articleTitle}`, {
              type: 'wikipedia', label: ref.articleTitle,
              url: `https://en.wikipedia.org/wiki/${encodeURIComponent(ref.articleTitle.replace(/ /g, '_'))}`,
            });
          }
        }
        for (const ref of otherRefs) {
          const info = await resolveChannelRef(ref, yt);
          if (!info) continue;
          upsertChannel(graph, info, 0);
          addSource(graph, info.id, `wiki:${ref.articleTitle}`, {
            type: 'wikipedia', label: ref.articleTitle,
            url: `https://en.wikipedia.org/wiki/${encodeURIComponent(ref.articleTitle.replace(/ /g, '_'))}`,
          });
        }

        // Resolve video refs to their channel via videos.list (batched).
        if (videoRefs.length) {
          const uniqueVideoIds = [...new Set(videoRefs.map((r) => r.videoId))];
          const apiVideos = await yt.videosByIds(uniqueVideoIds);
          const byId = new Map(apiVideos.map((it) => [it.id, it]));
          const channelIdsNeeded = [...new Set(apiVideos.map((it) => it.snippet.channelId))]
            .filter((id) => !graph.channels[id]);
          if (channelIdsNeeded.length) {
            const chItems = await yt.channelsByIds(channelIdsNeeded);
            for (const chItem of chItems) upsertChannel(graph, channelFromApi(chItem), 0);
          }
          for (const ref of videoRefs) {
            const apiVideo = byId.get(ref.videoId);
            if (!apiVideo) continue;
            const channelId = apiVideo.snippet.channelId;
            if (!graph.channels[channelId]) continue;
            addSource(graph, channelId, `wiki:${ref.articleTitle}`, {
              type: 'wikipedia', label: ref.articleTitle,
              url: `https://en.wikipedia.org/wiki/${encodeURIComponent(ref.articleTitle.replace(/ /g, '_'))}`,
            });
          }
        }

        cursor = page.exhausted ? null : page.nextCursor;
        wikiCursorState.cursors[query] = cursor;
        if (page.exhausted) break;
      }
    }
  } catch (err) {
    if (err.quotaExceeded) {
      quotaHit = true;
      errorLoud('Quota exhausted during Wikipedia seeding stage:', err.message);
    } else {
      throw err;
    }
  }

  // ---------- Stage 2: channel-section expansion ----------
  if (!quotaHit) {
    try {
      const queue = Object.values(graph.channels)
        .filter((ch) => !ch.sectionsChecked && ch.hop < pipelineConfig.expansion.maxHops)
        .sort((a, b) => a.hop - b.hop);
      let checked = 0;
      for (const ch of queue) {
        if (checked >= pipelineConfig.expansion.channelSectionsPerRun) break;
        let sections;
        try {
          sections = await yt.channelSections(ch.id);
        } catch (err) {
          if (err.quotaExceeded) throw err;
          warn(`channelSections.list failed for ${ch.id}, treating as empty:`, err.message);
          sections = [];
        }
        checked++;
        graph.channels[ch.id].sectionsChecked = true;
        const featuredIds = new Set();
        for (const section of sections) {
          for (const id of section.contentDetails?.channels || []) featuredIds.add(id);
        }
        if (featuredIds.size) {
          const needResolve = [...featuredIds].filter((id) => !graph.channels[id]);
          if (needResolve.length) {
            const items = await yt.channelsByIds(needResolve);
            for (const item of items) upsertChannel(graph, channelFromApi(item), ch.hop + 1);
          }
          for (const featuredId of featuredIds) {
            if (!graph.channels[featuredId]) continue; // API didn't return it (deleted/terminated channel) — treat as absent, not an error
            addSource(graph, featuredId, `channel:${ch.id}`, { type: 'channel', label: ch.title, url: `https://www.youtube.com/channel/${ch.id}` });
            addEdge(graph, `channel:${ch.id}`, featuredId, 'channel-feature');
          }
        }
      }
      log(`Expansion: checked channel sections for ${checked} channel(s).`);
    } catch (err) {
      if (err.quotaExceeded) {
        quotaHit = true;
        errorLoud('Quota exhausted during expansion stage:', err.message);
      } else {
        throw err;
      }
    }
  }

  // ---------- Stage 3: eligibility + ranking ----------
  const eligible = Object.values(graph.channels).filter(
    (ch) => !isChannelBlocked(ch.id, filtersConfig, excludedChannels)
  );
  const ranked = rankChannels(eligible, judgements, pipelineConfig.ranking);
  log(`Ranking: ${ranked.length}/${Object.keys(graph.channels).length} channels meet the distinct-source threshold and aren't blocked.`);

  // ---------- Stage 4: recent items for output-eligible channels ----------
  const itemsByChannel = new Map();
  if (!quotaHit) {
    const toFetch = ranked.slice(0, pipelineConfig.items.maxChannelsItemFetchPerRun);
    try {
      for (const ch of toFetch) {
        let videoIds = null;
        if (pipelineConfig.items.preferRssForRecentIds) {
          videoIds = await fetchRecentVideoIdsFromRss(ch.id, pipelineConfig.items.recentItemsPerChannel);
        }
        if (!videoIds) {
          const playlistId = pipelineConfig.items.useNoShortsUploadsFeed && ch.noShortsPlaylistId
            ? ch.noShortsPlaylistId
            : ch.uploadsPlaylistId;
          try {
            videoIds = await yt.playlistItemVideoIds(playlistId, pipelineConfig.items.recentItemsPerChannel);
          } catch (err) {
            if (err.quotaExceeded) throw err;
            if (playlistId !== ch.uploadsPlaylistId) {
              videoIds = await yt.playlistItemVideoIds(ch.uploadsPlaylistId, pipelineConfig.items.recentItemsPerChannel);
            } else {
              throw err;
            }
          }
        }
        if (!videoIds?.length) continue;
        const apiVideos = await yt.videosByIds(videoIds);
        itemsByChannel.set(ch.id, apiVideos.map(videoFromApi));
      }
    } catch (err) {
      if (err.quotaExceeded) {
        quotaHit = true;
        errorLoud('Quota exhausted during item-fetch stage:', err.message);
      } else {
        throw err;
      }
    }
  }

  // ---------- Stage 5: write artefacts ----------
  await buildIndexArtifacts({
    indexDir: PATHS.indexDir,
    rankedChannels: ranked,
    itemsByChannel,
    filtersConfig,
    excludedItemIds: excludedItems,
    log,
  });

  graph.generatedAt = new Date().toISOString();
  await writeJsonAtomic(PATHS.graph, graph);
  await writeJsonAtomic(PATHS.wikiCursor, wikiCursorState);

  const qSummary = quota.summary();
  log('Quota summary:', JSON.stringify(qSummary));

  if (quotaHit) {
    errorLoud(
      `Run stopped early due to quota budget (${qSummary.used}/${qSummary.budget} units). ` +
      `Index was still written from whatever data was gathered before the stop — nothing was corrupted, ` +
      `but this run is incomplete. Marking this workflow run as failed so it's visible.`
    );
    process.exitCode = 1;
  } else {
    log('Run completed within budget.');
  }
}

main().catch((err) => {
  errorLoud('Fatal error, aborting without touching data/index/ so the previously committed index is left untouched:', err.stack || err.message);
  process.exit(1);
});
