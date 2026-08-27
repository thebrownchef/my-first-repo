// Classifies a YouTube URL (found via Wikipedia's exturlusage) into either a
// channel reference (id/handle/user, needing resolution) or a video
// reference (needing resolution to its uploading channel). Ported from the
// same URL-shape handling as extractChannelRef() in youtube-browser.html,
// extended to also recognise bare video links.

export function classifyYouTubeUrl(url) {
  let m;
  if ((m = /youtube\.com\/channel\/(UC[\w-]{10,})/i.exec(url))) {
    return { kind: 'channel', type: 'id', value: m[1] };
  }
  if ((m = /youtube\.com\/@([\w.-]+)/i.exec(url))) {
    return { kind: 'channel', type: 'handle', value: '@' + m[1] };
  }
  if ((m = /youtube\.com\/(?:c|user)\/([\w.-]+)/i.exec(url))) {
    return { kind: 'channel', type: 'user', value: m[1] };
  }
  if ((m = /youtube\.com\/(?:watch\?[^#]*\bv=|embed\/|shorts\/)([\w-]{11})/i.exec(url))) {
    return { kind: 'video', value: m[1] };
  }
  if ((m = /youtu\.be\/([\w-]{11})/i.exec(url))) {
    return { kind: 'video', value: m[1] };
  }
  return null;
}

// Extracts every distinct YouTube reference from a batch of {title, url}
// Wikipedia exturlusage results, keeping track of which article each
// reference came from (an article can contribute more than one reference,
// but each reference keeps only the article set it appeared in — dedup of
// the *source* happens later, at the channel level, per the ranking spec).
export function extractRefsFromWikiPages(pages) {
  const channelRefs = []; // { type, value, articleTitle }
  const videoRefs = []; // { videoId, articleTitle }
  for (const page of pages) {
    const ref = classifyYouTubeUrl(page.url);
    if (!ref) continue;
    if (ref.kind === 'channel') {
      channelRefs.push({ type: ref.type, value: ref.value, articleTitle: page.title });
    } else {
      videoRefs.push({ videoId: ref.value, articleTitle: page.title });
    }
  }
  return { channelRefs, videoRefs };
}
