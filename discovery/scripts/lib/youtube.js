// Thin wrapper around the YouTube Data API v3 endpoints this system is
// allowed to use — all of them cost 1 unit per call regardless of how many
// ids are batched in, so batching aggressively (up to 50 ids) is the main
// quota lever. search.list is intentionally never called anywhere in this
// module.

const API_BASE = 'https://www.googleapis.com/youtube/v3';

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

async function call(path, params, quota, endpointLabel) {
  quota.charge(endpointLabel, 1);
  const url = new URL(API_BASE + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const isQuota = res.status === 403 && /quota/i.test(body);
    const err = new Error(`YouTube API ${endpointLabel} failed: ${res.status} ${body.slice(0, 300)}`);
    if (isQuota) err.quotaExceeded = true;
    throw err;
  }
  return res.json();
}

// channelsById/byHandle/byUsername deliberately request only snippet and
// contentDetails, plus statistics for videoCount-derived upload velocity.
// statistics.viewCount/subscriberCount come along in the same response but
// are never read anywhere downstream — this system does not rank or display
// by any engagement metric.
export function makeYouTubeClient({ apiKey, quota }) {
  async function channelsByIds(ids) {
    const out = [];
    for (const batch of chunk([...new Set(ids)], 50)) {
      const data = await call('/channels', {
        part: 'snippet,contentDetails,statistics',
        id: batch.join(','),
        key: apiKey,
      }, quota, 'channels.list');
      out.push(...(data.items || []));
    }
    return out;
  }

  async function channelByHandle(handle) {
    const data = await call('/channels', {
      part: 'snippet,contentDetails,statistics',
      forHandle: handle.replace(/^@/, ''),
      key: apiKey,
    }, quota, 'channels.list');
    return data.items?.[0] || null;
  }

  async function channelByUsername(username) {
    const data = await call('/channels', {
      part: 'snippet,contentDetails,statistics',
      forUsername: username,
      key: apiKey,
    }, quota, 'channels.list');
    return data.items?.[0] || null;
  }

  async function playlistItemVideoIds(playlistId, maxResults) {
    const ids = [];
    let pageToken = '';
    while (ids.length < maxResults) {
      const params = { part: 'contentDetails', playlistId, maxResults: Math.min(50, maxResults - ids.length), key: apiKey };
      if (pageToken) params.pageToken = pageToken;
      const data = await call('/playlistItems', params, quota, 'playlistItems.list');
      ids.push(...(data.items || []).map((it) => it.contentDetails.videoId));
      if (!data.nextPageToken) break;
      pageToken = data.nextPageToken;
    }
    return ids;
  }

  async function videosByIds(ids) {
    const out = [];
    for (const batch of chunk([...new Set(ids)], 50)) {
      if (!batch.length) continue;
      const data = await call('/videos', {
        part: 'snippet,contentDetails,liveStreamingDetails',
        id: batch.join(','),
        key: apiKey,
      }, quota, 'videos.list');
      out.push(...(data.items || []));
    }
    return out;
  }

  async function channelSections(channelId) {
    const data = await call('/channelSections', {
      part: 'snippet,contentDetails',
      channelId,
      key: apiKey,
    }, quota, 'channelSections.list');
    return data.items || [];
  }

  return { channelsByIds, channelByHandle, channelByUsername, playlistItemVideoIds, videosByIds, channelSections };
}

export function parseISODuration(iso) {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || '');
  if (!m) return 0;
  const h = +(m[1] || 0), min = +(m[2] || 0), s = +(m[3] || 0);
  return h * 3600 + min * 60 + s;
}

export function channelFromApi(item) {
  const uploads = item.contentDetails.relatedPlaylists.uploads;
  const noShortsPlaylistId = uploads.startsWith('UU') ? 'UULF' + uploads.slice(2) : null;
  const videoCount = +(item.statistics?.videoCount || 0);
  const createdAt = item.snippet.publishedAt;
  const ageDays = Math.max(1, (Date.now() - new Date(createdAt)) / 86400000);
  return {
    id: item.id,
    title: item.snippet.title,
    thumb: item.snippet.thumbnails?.default?.url || '',
    uploadsPlaylistId: uploads,
    noShortsPlaylistId,
    videoCount,
    uploadsPerDay: videoCount ? videoCount / ageDays : 0,
    createdAt,
  };
}

export function videoFromApi(item) {
  const durationSec = parseISODuration(item.contentDetails.duration);
  const liveBroadcastContent = item.snippet.liveBroadcastContent;
  return {
    id: item.id,
    channelId: item.snippet.channelId,
    channelTitle: item.snippet.channelTitle,
    title: item.snippet.title,
    description: item.snippet.description || '',
    thumb: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || '',
    publishedAt: item.snippet.publishedAt,
    durationSec,
    isLive: !!(liveBroadcastContent && liveBroadcastContent !== 'none'),
  };
}
