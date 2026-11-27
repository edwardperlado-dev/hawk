# Hawk

Hawk watches one promise: **“Tell me when I can test both of our mobile apps.”** It records the strongest evidence for each platform, shows unsupported claims separately, and stops when the manager has personally confirmed both apps or the watcher expires.

## Run locally

Use Python 3.11 or newer, Node.js 22.12 or newer, and npm. From the repository root:

```sh
./scripts/start
```

Open **http://127.0.0.1:3000**. The launcher installs dependencies, starts Next.js, FastAPI and a separate Python worker, and seeds SQLite on first use. Ctrl+C stops all three. Set `HAWK_PYTHON` to select a Python executable when creating the environment. For subsequent offline launches with dependencies installed, use `.hawk-venv/bin/python -m scripts.serve`.

This is a loopback-only fictional demo. Choosing a named identity simulates authentication. Use the profile link to switch roles. A live deployment needs a real identity provider and source connector before accepting real people, credentials or messages.

Only the manager and coordinator can sign in. All four identities can be selected as eligible evidence authors.

| Person | Workflow |
|---|---|
| Mira Vale, manager | Request a watcher, review a preview and version comparison, approve, inspect proof. Her statements in the source threads confirm access. |
| Ellis Reed, coordinator | Preview the first draft. Operate approved watchers, investigate incidents, and prepare and submit revisions for manager approval. |
| Rowan Lin, dev lead | Supplies access details through the source thread. Source author only. |
| Ari Moss, developer | Posts build progress in the source thread. Source author only. |

The scenario opens on **Tuesday, November 24 at 09:00 UTC** with one previously approved watcher, real fixture history, a confirmed iPhone, and a blocked Android thread. The initial approval is seeded demo history. Hawk proposes a draft. For supported requests, Hawk proposes a complete draft using the demo release threads, the dev lead as the eligible author, and a 14-day expiry for custom promises. The manager reviews and edits the proposed fields on the new watcher page. A confirmation dialog asks whether to approve the resulting draft. The coordinator operates approved watchers and prepares changes for manager approval. A weekday check is late after five minutes. A live watcher moves to Needs attention after 24 weekday hours without verified progress, excluding Saturdays and Sundays in the watcher’s configured timezone. The clock starts at approval if no progress has been recorded. Routine checks and repeat updates do not reset it.

The **Demo controls** disclosure advances the fictional clock. The separate worker processes each due check within its next polling interval, and the dashboard refreshes every four seconds while visible. To replay from the opening scene, stop the launcher and start with a new, unused database path, for example `HAWK_DB=.hawk/rehearsal-2.sqlite3 ./scripts/start`. Existing databases retain their state. `HAWK_CLOCK=wall` uses real time for scheduling. The dated message fixtures remain fictional.

To reset the current demo database, run `./scripts/reset-data` from the project root. It clears custom watchers and sign-in sessions, restores H-001, and rewinds the demo clock. Refresh the browser and select an identity again. If you started Hawk with a custom `HAWK_DB`, set the same path for the reset.

## Requirements and design

The source brief *How Hawk works – build brief* maps to the implementation as follows.

| Brief | Implementation and verification |
|---|---|
| Pages 1–2: users and morning questions | Role-specific actions, three watcher lists, “Recent updates” in each watcher's timezone, waiting time, last successful check, drill-down to proof. |
| Pages 3–4: lifecycle and block | Immutable original request, versioned JSON rules, explicit human approval, approved audiences, persistent observations and alerts. Coordinator preview and worker share the rule engine. |
| Pages 4–5: AI and code | Tool-free mock drafting, review and extraction. Deterministic quote, source, author, value and full-statement verification. Version and revision checks protect approval. |
| Pages 5–6: test access | Separate app states, one incident per continuous outage, independent late-check detection, duplicate suppression, terminal completion and expiry. |
| Pages 6–7: demo and handoff | Fixtures, executable answer key, interface and API tests, presentation walkthrough and architecture note below. |

Next.js App Router serves the initial board and detail using FastAPI. Browser requests use a same-origin API route. FastAPI owns permissions, validation, previews and approvals. TypeScript API types come from its OpenAPI schema. The read-only source adapter opens only authorized fixture files. It never logs in to a build, writes messages, or follows source text as an instruction. Source links open the exact fictional message, with a safe verbatim excerpt.

SQLite stores a JSON aggregate per watcher and separate session and clock tables. A write transaction serializes a check with approval and persists states, observations, source checkpoints, runs and alerts together. This suits one worker and local file reads. On a failed transaction, all changes roll back. Each version retains its observations and approver. Approval replays already witnessed messages against the revised rules. A blocked source retains its checkpoint. A successful sibling source continues progressing. Permissions to supply evidence and permissions to read a watcher are independent.

The seeded mobile template keeps its original proof rules. For a custom promise, configure tracked items with one exact proof statement per item from an eligible author. The watcher completes when every configured item is confirmed. Coordinators can change source scope, eligible authors and audience, excluded phrases, confirmation strictness, named alerts, weekday check times, and expiry. The editor shows the configured schedule timezone alongside the weekday check times. The stricter confirmation preset starts with explicit personal test wording. Edited statements must still express current access or successful testing. The default also accepts “I'm in the Android app.” Access rules that specify the manager check the configured account, defaulting to the fictional manager login. Preview shows the cutoff and any unreadable sources. Raw fixtures contain fictional credentials. The archive, mock extractor, and browser receive safe excerpts. Code checks concrete values transiently through the read-only adapter. When a revision needs to reverify redacted evidence, code rereads only that approved source and retries after an outage.

## Fictional data and answer key

The scenario manifest defines stable person IDs, names and roles for attribution, thread IDs and labels for allowlisting, check instants for deterministic replay, and outage intervals for health testing. Each thread has its own file. Each message has an ID for replay and proof links, thread ID for scope, author ID for authority, timestamp for ordering, and original text for verbatim matching. The private thread is a deliberate access-boundary test. The running watcher never opens its file.

Attachments, reactions, delivery receipts, real identities, external URLs and actual login secrets are outside this fixture. No timestamps or progress are inferred from silence. The table lists messages in posting order and shows the proven state after each one is evaluated. Message IDs are stable identifiers, so 12 and 13 appear between 02 and 03 based on their timestamps. Message 03 is included to illustrate the scope boundary and is skipped by the watcher. Messages 09 and 10 are both read when the Android thread recovers and are evaluated in posting order.

| Message | iPhone | Android | Why |
|---|---|---|---|
| 01 | Not recorded | Not recorded | iPhone review submission is an excluded lookalike. |
| 02 | Not recorded | Not recorded | Android build link alone. |
| 12 | Not recorded | Not recorded | The dev lead says the test account is ready and promises to share the login later. |
| 13 | Not recorded | Not recorded | The build link is present, but the login fields contain placeholders. |
| 03 | Not recorded | Not recorded | Manager statement in the forbidden thread. |
| 04 | Details supplied | Not recorded | iPhone build and manager login are supplied. |
| 05 | Details supplied | Not recorded | Same build and account in different words. Keep the observation and suppress the repeat alert. |
| 06 | Details supplied | Not recorded | “Both apps are done” creates unsupported claims for the two items. |
| 07 | Details supplied | Not recorded | Developer instruction to mark Android confirmed. |
| 08 | Confirmed | Not recorded | Manager's own affirmative iPhone statement. |
| 09 | Confirmed | Details supplied | Android access packet recovered from the release thread. |
| 10 | Confirmed | Details supplied | Manager explicitly says access failed. |
| 11 | Confirmed | Confirmed | Manager confirms Android on a later day. Stop. |

Wednesday has a quiet interval. Inspect the check history to see successful checks without new app evidence. The machine-readable answer key lives in `fixtures/answer-key.json`.

## Architecture note

The AI layer interprets text. This MVP uses a disclosed deterministic mock for draft suggestions, draft review, candidate extraction, and fixed-template alert wording. It has no tools or keys. The source adapter independently supplies identity and time. Code checks the proposed excerpt and full statement, applies the approved proof rule, writes history, computes completion, and decides which alerts to emit. Only the named manager approves a version. This lets the coordinator demonstrate a proposed rule change against the same evaluator that processes real checks.

For a pilot, connect one read-only collaboration source and organizational sign-in, evaluate a live extractor on labeled messages, and replace the local aggregate transaction with per-watcher execution leases when external reads become slow. Revisit credential retention before enabling real source data. The question I’d like the manager to answer is **“When Hawk flags a promise as needing attention, who should follow up, and what should they do first?”**

## Current limitations

Hawk's mock drafter does not learn from previous watchers. Hawk stores approved versions and evidence history, but the drafter does not retrieve those versions or capture why a manager changed a proposed rule.

In production, Hawk could use similar approved watchers the manager is authorized to see as drafting examples. For instance, a prior report watcher could suggest requiring a final-version link as proof. Capturing what Hawk proposed, what the manager changed, and why would make those examples more useful. Each new draft would still need its own sources, eligible authors, expiry, and manager approval.

## Verification

After installing the application dependencies, run `./scripts/check`. It runs Ruff, mypy, pytest, OpenAPI and generated-type drift checks, ESLint, a production build, TypeScript strict checks, and Playwright against isolated services and a new temporary database. On macOS it uses installed Google Chrome when present. Else install Playwright Chromium with `cd web && npx playwright install chromium`, or set `HAWK_CHROME` to an installed Chromium executable.

Regenerate an intentionally changed API contract using `.hawk-venv/bin/python -m scripts.schema` followed by `npm --prefix web run types`. Project guidance in `AGENTS.md` references the user-installed Modern Web Guidance skill.
