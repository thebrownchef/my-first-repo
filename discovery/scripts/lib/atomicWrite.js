import { writeFile, rename, readFile } from 'node:fs/promises';

// Writes JSON to a temp file, verifies it re-parses, then renames it over
// the target — so a crash mid-write (or a run that aborts on quota) never
// leaves a half-written, corrupt artefact in place of a previously good one.
export async function writeJsonAtomic(path, data) {
  const text = JSON.stringify(data, null, 2) + '\n';
  JSON.parse(text); // fail fast if something produced a non-serializable value
  const tmpPath = `${path}.tmp-${process.pid}`;
  await writeFile(tmpPath, text, 'utf8');
  await readFile(tmpPath, 'utf8').then(JSON.parse); // verify on disk before committing to the real path
  await rename(tmpPath, path);
}

export async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}
