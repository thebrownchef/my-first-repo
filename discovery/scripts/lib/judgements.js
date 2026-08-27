import { readJson } from './atomicWrite.js';

// Read-only from the job's perspective — see discovery/data/judgements.json
// for the format and the guarantee that a regeneration never writes here.
export async function loadJudgements(path) {
  return readJson(path, {
    schemaVersion: 1,
    channelJudgements: {},
    itemJudgements: {},
    sourceJudgements: {},
  });
}

export function excludedChannelIdSet(judgements) {
  return new Set(
    Object.entries(judgements.channelJudgements)
      .filter(([, j]) => j.verdict === 'excluded')
      .map(([id]) => id)
  );
}

export function excludedItemIdSet(judgements) {
  return new Set(
    Object.entries(judgements.itemJudgements)
      .filter(([, j]) => j.verdict === 'excluded')
      .map(([id]) => id)
  );
}
