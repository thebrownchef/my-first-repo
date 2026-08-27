// Ranks channels by distinct-source count, weighted by user judgements on
// the sources and channels themselves. A channel judged 'excluded' (or on
// the static config block list) is dropped outright regardless of score —
// that check happens in the caller via filters.isChannelBlocked, before
// this module ever sees the channel.

export function sourceWeight(sourceId, judgements, weights) {
  const j = judgements.sourceJudgements[sourceId];
  if (j?.verdict === 'positive') return weights.positiveSourceMultiplier;
  if (j?.verdict === 'negative') return weights.negativeSourceMultiplier;
  return 1;
}

export function computeChannelScore(channel, judgements, weights) {
  const sourceIds = Object.keys(channel.sources);
  let weight = sourceIds.reduce((sum, id) => sum + sourceWeight(id, judgements, weights), 0);
  const cj = judgements.channelJudgements[channel.id];
  if (cj?.verdict === 'positive') weight *= weights.positiveChannelMultiplier;
  if (cj?.verdict === 'negative') weight *= weights.negativeChannelMultiplier;
  return { score: Math.round(weight * 1000) / 1000, distinctSourceCount: sourceIds.length };
}

// eligibleChannels: array of graph channel records (already excludes blocked
// channels). Returns them annotated with score/distinctSourceCount, filtered
// by minDistinctSources, sorted descending by score.
export function rankChannels(eligibleChannels, judgements, rankingConfig) {
  return eligibleChannels
    .map((ch) => {
      const { score, distinctSourceCount } = computeChannelScore(ch, judgements, rankingConfig.weights);
      return { ...ch, score, distinctSourceCount };
    })
    .filter((ch) => ch.distinctSourceCount >= rankingConfig.minDistinctSources)
    .sort((a, b) => b.score - a.score || b.distinctSourceCount - a.distinctSourceCount || a.title.localeCompare(b.title));
}
