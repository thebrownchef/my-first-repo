# Signal Discovery

A two-part system for finding YouTube channels/videos via citation graphs
rather than YouTube's own recommendation algorithm:

1. **Ingestion job** (`scripts/`) — runs in GitHub Actions on a schedule and
   on manual trigger. Crawls Wikipedia for YouTube citations, expands via
   channels' own featured-channel sections, ranks, filters, and writes the
   result to `data/index/*.json`. All network access to YouTube and
   Wikipedia happens here — the reader never makes an API call.
2. **Reader** (`reader/`) — a static, dependency-free HTML/JS/CSS page
   served over HTTPS via GitHub Pages. Loads the committed JSON, renders a
   graph view and a list view, and stores your judgements/queue in the
   browser's `localStorage`. No build step, no server, no API key.

The two communicate **only** through the JSON files committed under
`discovery/data/`. This is a separate application from `youtube-browser.html`
at the repo root, which is left in place unmodified. This system's filter
predicates (duration/live/keyword/regex/channel-blocklist) are ported from
that file's `isVideoAllowed()`/`titleBlocked()` logic — see
`scripts/lib/filters.js`.

## Setup

1. **Get a YouTube Data API v3 key** (Google Cloud Console → enable "YouTube
   Data API v3" → Credentials → API key). Free tier.
2. **Add it as a repository secret** named `YOUTUBE_API_KEY`: repo Settings →
   Secrets and variables → Actions → New repository secret.
3. **Enable GitHub Pages** with source "GitHub Actions": repo Settings →
   Pages → Build and deployment → Source → GitHub Actions. The
   `discovery-pages.yml` workflow then deploys automatically on the next
   push that touches `discovery/reader/` or `discovery/data/`.
4. **Trigger the first ingestion run** manually: Actions tab → "Discovery
   ingest" → Run workflow. Don't wait for the schedule — `data/index/` starts
   out empty (placeholder files with `channels: []`), and the reader says so
   until the first run completes.
5. Open the published Pages URL. It's static and safe to use from a
   locked-down machine — nothing to install, no local runtime, HTTPS only.

## Schedule

Configured in `.github/workflows/discovery-ingest.yml`: `17 6 * * *` (06:17
UTC daily), plus manual trigger (`workflow_dispatch`) at any time from the
Actions tab. See "Conflicts with the brief" below for why the cron lives in
the workflow file rather than a config JSON.

## Quota budget per run

- Daily ceiling: 10,000 units for every endpoint this system uses
  (`channels.list`, `playlistItems.list`, `videos.list`,
  `channelSections.list` — all 1 unit/call regardless of batch size up to 50
  ids). `search.list` is never called.
- Configured budget: `discovery/config/pipeline.json` → `quota.dailyUnitBudget`
  = **9000**, deliberately below the real ceiling to absorb jitter from
  retries or other tools sharing the same key.
- The job tracks every call and logs a summary
  (`{used, budget, remaining, byEndpoint}`) at the end of each run.
- If a run would exceed the budget, it **stops making calls immediately**,
  still builds and commits a valid index from whatever was gathered so far
  (writes are atomic — temp file + verify + rename — so a stopped run never
  leaves a half-written or corrupt JSON file), and **exits non-zero** so the
  Actions run shows as failed. This is a deliberate reading of the brief's
  two directives ("abort cleanly... rather than partially corrupting" and
  "fail loudly if a run would exceed budget") as compatible: clean-but-loud,
  not clean-and-silent. See `scripts/run.js`.
- Rough per-run cost: seeding (~2 calls/query/page for channel/video
  resolution, batched), expansion (1 call per channel section-checked, capped
  at `expansion.channelSectionsPerRun` = 200/run), item fetch (1 call per
  channel for recent-video IDs *only if the RSS fallback fails*, plus 1 call
  per 50 videos for details, capped at `items.maxChannelsItemFetchPerRun` =
  300/run). Comfortably inside budget at these defaults; tune the caps in
  `config/pipeline.json` if you widen `expansion.maxHops` or the Wikipedia
  page count.

## Configuration

All in version-controlled JSON, no hardcoded thresholds in the scripts:

- `config/filters.json` — the index-time filter pipeline (min/max duration,
  live/upcoming exclusion, title keyword/regex blocklists, channel
  blocklist). Every stage has its own `enabled` flag, defaulting to `true`.
- `config/pipeline.json` — Wikipedia query list and page-per-run cap, hop
  count, channel-sections-per-run cap, ranking weights and minimum
  distinct-source threshold, quota budget, recent-items-per-channel cap.
- `data/judgements.json` — **not** pipeline config, but also not code: your
  👍/👎/🚫 verdicts on channels, items, and sources. The crawl reads this as
  input (it changes ranking weights and holds back excluded channels/items);
  a regeneration never writes to it. Edit by hand, or export from the reader
  (Settings tab) and commit the result via a PR.

## Known limitations

- **Transcripts are unavailable.** YouTube's `timedtext` endpoint now returns
  an empty 200 body for programmatic requests once the caption track URL
  carries a Proof-of-Origin token (`exp=xpe`), and there's no available
  workaround. No feature here depends on transcript text. Per-item triage
  signals are limited to title, duration, publish date, description, and any
  chapter list derivable from the description's own timestamp lines
  (`scripts/lib/chapters.js`) — genuinely lighter than transcript skimming,
  but it's what's left.
- **Cloud-IP fragility.** GitHub Actions runners are cloud IPs, which
  YouTube rate-limits and blocks more aggressively than residential ones.
  The one unofficial surface this system touches — the `videos.xml` uploads
  RSS feed, used as a zero-quota way to get a channel's recent video IDs
  (`scripts/lib/rss.js`) — is therefore best-effort: any failure (timeout,
  non-200, empty body, blocked) falls back silently to `playlistItems.list`
  (1 unit) and never throws in a way that stops the run.
- **The reader must be served over HTTPS.** `file://` origins are opaque, so
  `localStorage` (judgements, queue) is unavailable there. The reader does
  not attempt to support being opened from disk — see its boot-time error
  message if you try.
- **Wikipedia coverage is a proxy for "cited," not "good."** A channel with
  many Wikipedia citations is well-documented, not necessarily
  slop-free — the existing keyword/regex/channel blocklists still apply on
  top of this.
- **`eulimit=max`** is used for the `exturlusage` calls rather than a fixed
  number; see "Conflicts with the brief" below for why.
- **Channel-section expansion is bounded and incremental**, not exhaustive
  in one run — `sectionsChecked` is a persisted per-channel flag in
  `data/state/graph.json`, so a channel is only re-checked if it's newly
  discovered. A channel whose owner adds new featured channels later won't
  be picked up automatically without clearing that flag.

## Cost / free-tier flags

- **YouTube Data API v3**: free, 10,000 units/day. This system budgets to
  9000. No paid tier is used or required.
- **MediaWiki API (Wikipedia)**: free, no key, no rate-limit tier — request
  volume here is small (a few pages per query per run) and a descriptive
  User-Agent is set per Wikimedia's API etiquette.
- **GitHub Actions**: free for public repositories. A private repository
  would consume included minutes (2,000/month on the free plan) — this job's
  runs are short (well under a minute of actual work plus Node startup), so
  this is very unlikely to matter, but is flagged since it's the one
  dependency whose cost depends on a setting outside this repo's control
  (repo visibility).
- **GitHub Pages**: free for public repositories.
- No database, no server, no other paid service anywhere in this system.

## Conflicts with the brief (reported per instructions)

- **Schedule as configuration.** The brief asks for schedule to live in
  version-controlled configuration files, not be hardcoded. GitHub Actions
  requires the cron expression to be defined in the workflow YAML itself —
  there's no mechanism for a workflow to read its own trigger schedule from
  a JSON file at trigger-evaluation time (the schedule has to exist before
  any job runs). Resolution: the cron lives in
  `.github/workflows/discovery-ingest.yml`, and `config/pipeline.json`
  carries an informational mirror of it (`schedule.cron`) purely so it's
  visible and diffable alongside the other tunables. If you change one,
  change the other — nothing enforces they match.
- **`exturlusage` page size.** The brief states it "returns up to 500 pages
  per call." In practice, MediaWiki's anonymous (unauthenticated) rate limit
  for this module is 50 per call; 500 requires a bot or sysop flag on the
  querying account, which this system doesn't have (no authentication, per
  the brief's own "requires no authentication" framing). Resolution: request
  `eulimit=max`, which asks the API to clamp automatically to whatever the
  caller is actually allowed rather than erroring — so the system gets 500
  if a future maintainer authenticates a privileged bot account, and 50
  otherwise, without a code change either way.
