// Index-time filter pipeline. Ported from youtube-browser.html's
// isVideoAllowed()/titleBlocked() predicates (see that file's
// getHardFilters()/getBlocklists()/titleBlocked()) — same logic, now driven
// by discovery/config/filters.json instead of IndexedDB, and returning which
// stage rejected an item (useful for logging) rather than a plain boolean.

function titleHasKeyword(title, keywords) {
  const lower = title.toLowerCase();
  return keywords.some((kw) => kw && lower.includes(kw.toLowerCase()));
}

function titleMatchesRegex(title, patterns) {
  return patterns.some((p) => {
    try {
      return p && new RegExp(p, 'i').test(title);
    } catch {
      return false;
    }
  });
}

// item: { id, channelId, title, durationSec, isLive }
// excludedItemIds: a Set of video ids the user has permanently excluded
// (from judgements.json's itemJudgements), applied like any other stage.
export function evaluateItem(item, filtersConfig, excludedItemIds) {
  const f = filtersConfig;
  if (excludedItemIds?.has(item.id)) return { allowed: false, stage: 'userExcluded' };
  if (f.excludeLiveAndUpcoming.enabled && item.isLive) return { allowed: false, stage: 'excludeLiveAndUpcoming' };
  if (f.minDuration.enabled && item.durationSec < f.minDuration.seconds) return { allowed: false, stage: 'minDuration' };
  if (f.maxDuration.enabled && item.durationSec > f.maxDuration.hours * 3600) return { allowed: false, stage: 'maxDuration' };
  if (f.channelBlocklist.enabled && f.channelBlocklist.channelIds.includes(item.channelId)) {
    return { allowed: false, stage: 'channelBlocklist' };
  }
  if (f.titleKeywordBlocklist.enabled && titleHasKeyword(item.title, f.titleKeywordBlocklist.keywords)) {
    return { allowed: false, stage: 'titleKeywordBlocklist' };
  }
  if (f.titleRegexBlocklist.enabled && titleMatchesRegex(item.title, f.titleRegexBlocklist.patterns)) {
    return { allowed: false, stage: 'titleRegexBlocklist' };
  }
  return { allowed: true, stage: null };
}

export function isChannelBlocked(channelId, filtersConfig, excludedChannelIds) {
  if (excludedChannelIds?.has(channelId)) return true;
  return filtersConfig.channelBlocklist.enabled && filtersConfig.channelBlocklist.channelIds.includes(channelId);
}
