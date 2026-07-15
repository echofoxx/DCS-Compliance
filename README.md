# DCS Assessment Command Center

A **web application for planning, executing, scoring, and reporting Data-Centric
Security (DCS) compliance assessments** during operational events — Docker-hosted
for team use, or standalone in a single browser when there is no server.

It is an assessment command center, not a basic checklist. Every screen is built
around one question:

> **Did the event prove that protected data can be discovered, labeled, governed,
> accessed, denied, shared, monitored, and audited under Zero Trust conditions?**

The assessment content follows the *DCS Assessment Framework* white paper:
**55 compliance checks (DCS-01 … DCS-55) across 10 DCS domains**, a 0–4 maturity
rubric, a findings severity model with red-flag gating, a test-card evidence
schema, and the 30/60/90/180-day reporting roadmap.

![Executive Dashboard](docs/screenshots/01-dashboard.png)

---

## Table of contents

1. [At a glance](#at-a-glance)
2. [Screenshots](#screenshots)
3. [Quick start](#quick-start)
4. [User guide — running an assessment end to end](#user-guide--running-an-assessment-end-to-end)
5. [Module reference](#module-reference)
6. [Scoring engine and the critical gate](#scoring-engine-and-the-critical-gate)
7. [Running a program of assessments](#running-a-program-of-assessments)
8. [Docker deployment and configuration](#docker-deployment-and-configuration)
9. [Data model and integrations](#data-model-and-integrations)
10. [Optional local AI drafting](#optional-local-ai-drafting)
11. [Data safety and backup](#data-safety-and-backup)
12. [Roadmap](#roadmap)
13. [Standards references](#standards-references)
14. [Repository layout](#repository-layout)
15. [Development](#development)

---

## At a glance

| Capability | What it does |
|---|---|
| Full-lifecycle workbench | Planning → Assessment Design → On-Site Execution → Analysis & Reporting, tracked as an explicit event **phase** |
| 55-item DCS compliance checklist | All white-paper items across 10 domains, each with an assessment question, expected evidence, severity-if-failed, and NIST 800-53 / DoD ZT / CISA / NSA standards mappings |
| Scenario test cards | Expected vs. actual DCS outcome (allow / deny / redact / mask / quarantine), PDP/PEP results, latency, one-click "convert failure to finding" |
| Evidence Locker with chain of custody | Typed records with source, captured-by, timestamp, classification, quality grade, and file attachments |
| Decision-log ingestion | Import PDP/PEP/SIEM exports (CSV, JSON, NDJSON) with an audit reconstruction timeline and automatic false-allow / false-deny detection |
| Findings with full traceability | Mission Thread → Checklist Item → Test Card → Evidence → Finding, clickable at every step |
| Report Builder | Print-ready final assessment report (11 sections) plus CSV / JSON exports |
| Program view | Cross-event maturity trend, domain × event matrix with first→latest deltas, program-wide open critical gaps, reusable strength patterns |
| Bulk import | CSV templates for participants and protected data objects |
| Optional local AI drafting | Draft finding impact/recommendation and the executive narrative via a locally hosted model (Ollama) — draft-only guardrail |
| Docker-hosted, shared team workspace | Zero-dependency Node server, revision-based conflict detection, offline-tolerant, persistent Docker volume; standalone browser mode still works |
| Runs offline / on-site | Local-first design, no external network dependencies, works in restricted environments |

---

## Screenshots

Executive Dashboard — readiness gauge, weighted domain heatmap, evidence-gap
tracker, and mission-thread status; every card drills into the underlying items.

![Executive Dashboard](docs/screenshots/01-dashboard.png)

Event Workspace — event profile with the assessment phase selector, plus the
event readiness meter (planning inputs) that appears above every tab.

![Event Workspace — profile](docs/screenshots/02-event-workspace.png)

Mission threads tie every checklist item and test card to an operational
outcome. Editable in place; each thread shows its linked tests and findings.

![Mission threads](docs/screenshots/03-mission-threads.png)

DCS Checklist — all 55 items grouped by domain, filterable by domain, result,
workflow, severity, missing evidence, owner, and mission thread.

![Checklist](docs/screenshots/04-checklist.png)

Drill into any item to see the requirement, assessment question, expected
evidence, standards mapping, and score / result / evidence links.

![Checklist drawer](docs/screenshots/05-checklist-drawer.png)

Test Cards — expected vs. actual DCS outcome, PDP / PEP results, latency,
hotwash notes, and one-click conversion of failures into findings.

![Test Cards](docs/screenshots/06-testcards.png)

Evidence Locker — typed evidence with chain-of-custody metadata, quality grade,
optional file attachments, and links back to checks, tests, and findings.

![Evidence Locker](docs/screenshots/07-evidence-locker.png)

Findings — severity model (Critical / Major / Moderate / Observation /
Strength), remediation status, and full end-to-end traceability.

![Findings](docs/screenshots/08-findings.png)

Every finding's traceability chain: Mission Thread → Checklist Item → Test Card
→ Evidence. Each step is clickable — it is the defensible path from operational
need to the finding.

![Finding traceability](docs/screenshots/09-finding-traceability.png)

Report Builder — print-ready final report with selectable sections; export CSV
or JSON for the appendix package.

![Report Builder](docs/screenshots/10-report.png)

Program view — the cross-event picture for an assessment series: readiness
trend, domain × event maturity with first→latest deltas, and the reusable
strengths library.

![Program view](docs/screenshots/11-program.png)

Getting Started card — appears on the dashboard of a fresh event and disappears
on its own once planning is complete and scoring begins.

![Getting Started](docs/screenshots/12-getting-started.png)

---

## Quick start

### Docker (recommended for the team)

```bash
docker compose up -d      # → http://<host>:8080
```

Or without compose:

```bash
docker build -t dcs-command-center .
docker run -d --name dcs-command-center \
  -p 8080:8080 \
  -v dcs-data:/data \
  dcs-command-center
```

In Docker mode, the whole assessment team browses to one URL and works from a
**single server-persisted workspace** that lives on the mounted `dcs-data`
volume and survives container restarts. The sidebar footer confirms the mode:
*"Server-synced · shared team workspace."*

### Standalone (no server, single browser)

The same files also run without a backend:

```bash
python3 -m http.server 8080
# open http://localhost:8080
```

…or simply open `index.html` directly. In standalone mode data lives in the
browser's `localStorage` (per-browser, per-machine); the sidebar footer shows
*"Local-first · data stays in this browser."* Use **⬇ Backup Workspace** and
**Events ▾ → Import JSON** to move data between machines.

A pre-populated **sample event** loads on first run so every screen has data.
Delete it from **Events ▾ → Delete Event** once you create your own.

---

## User guide — running an assessment end to end

The app is organized around the assessment phases from the DCS Framework white
paper. The **assessment phase** on each event (top-bar chip, editable in Event
Workspace → Event Profile) tells the team where the event stands.

### Phase 1 — Scope & Planning (July–August)

**Goal:** define what will be assessed and what "success" looks like before
anyone touches a control.

1. **Create the event** — *Events ▾ → + New Event*. Give it a name, location,
   event window, and classification. A fresh, unscored copy of the 55-item
   checklist template comes with it.
2. **Event Profile** (Event Workspace → Event Profile) — record the objectives,
   participating organizations, assessment period, and standards alignment.
   Set the **Assessment Phase** to *Scope & Planning*.
3. **Mission Threads** — add each operational scenario the DCS capability must
   support. Example: *"Coalition operational data sharing — partner sees
   authorized information only."* Every checklist item and test card gets tied
   back to one of these threads.
4. **Protected Data Objects** — register the datasets, APIs, feeds, files, and
   data products that the assessment will exercise. Record classification,
   releasability, caveats, required protections, and risk rating. Use *CSV
   Template → Import CSV* for bulk loading from a spreadsheet.
5. **Participants & Systems** — record the assessors, stewards, SMEs, and the
   systems in scope (PDPs, PEPs, gateways, data platforms, telemetry).
   Participants also accept CSV import.
6. **Compliance Weights** — accept the defaults (labeling, policy, enforcement,
   audit weighted heaviest) or adjust to match your event's emphasis. Weights
   must total 100 %.

**Check:** the **Event Readiness Meter** at the top of Event Workspace tracks
these 8 planning inputs. The Dashboard shows a **Getting Started** card with
one-click next-step buttons until planning is complete.

### Phase 2 — Assessment Design (August–September)

**Goal:** turn scope into a repeatable execution plan with expected outcomes.

1. **Assign checklist items** — Checklist → *Bulk Assign* to distribute domains
   to assessors, or open individual items to set the owner. Filter by
   *"Any owner"* to see what is still unassigned.
2. **Link checklist items to mission threads** — inside each item's drawer,
   tick the threads it supports. This is what makes the final findings trace
   back to mission impact.
3. **Build test cards** — Test Cards → *+ From Scenario Library* pulls proven
   patterns (denial test, label persistence through a gateway, bypass attempt,
   bulk export, revocation, audit reconstruction, fails-closed on bad labels,
   degraded comms). Each library card arrives pre-linked to the checklist
   items it proves. Fill in the scenario detail: requestor, requestor
   attributes, protected data object, expected outcome.
4. **Move the phase to *Assessment Design***.

### Phase 3 — On-Site Execution (October)

**Goal:** observe controls in operation and collect defensible evidence.

1. **Set the phase to *On-Site Execution***.
2. **Ingest decision logs** — Evidence Locker → *⇪ Ingest Decision Log* pulls
   PDP/PEP/SIEM exports (CSV, JSON array, or NDJSON) directly into evidence
   with auto-summary stats, latency, and expected-vs-actual comparison.
   **False allows are flagged loudly** in the toast and audit drawer.
3. **Run test cards** — for each executed test, record the actual outcome,
   PDP / PEP results with reason codes, latency, and hotwash notes. If the
   test fails, use *Convert Failure to Finding* — the linked checks, tests,
   and evidence flow into the finding automatically.
4. **Score checklist items** — open each item, set the 0–4 maturity score, the
   pass/partial/fail result, and attach the evidence that supports the score.
   The dashboard's **Evidence Gap Tracker** flags any scored item that has no
   evidence — those scores cannot be defended in the final report.
5. **Daily rollups / hotwash** — Event Workspace → Daily Log captures what was
   assessed, what broke, what was decided, and what happens next (Issues →
   Decisions → Actions). The white paper's Day 0–5 execution model is shown
   for reference.
6. **Watch the critical gate** — the top-bar readiness chip turns red the
   moment a critical item fails or an open critical finding appears. This is
   deliberate: it prevents a misleading green rating when a false allow or
   label loss has happened.

### Phase 4 — Analysis & Reporting (November–December)

**Goal:** compare expected vs. actual, write findings, deliver the report.

1. **Set the phase to *Analysis & Reporting***.
2. **Findings** — for each gap, write the impact and prioritized recommendation,
   assign an owner and due date, and set the remediation status. Use the
   optional local-AI *Draft impact & recommendation* button to bootstrap the
   text from the linked items, tests, and evidence.
3. **Executive Narrative** — Report Builder → the Executive Narrative field
   sits at the top of the report's Executive Summary. The AI can draft it from
   the event's recorded scores and findings; the assessor owns the final
   wording.
4. **Generate the report** — select the sections you want (11 available), then
   *Generate Report* → *Print / Save as PDF* for the deliverable. Add the
   Checklist CSV, Findings CSV, Evidence Index CSV, and Full Event JSON to
   the appendix package.
5. **Move the phase to *Complete / Archived***. The event stays in the Program
   view for cross-event comparison.

---

## Module reference

| Module | Notes |
|---|---|
| **Dashboard** | Readiness gauge with the critical-gate note, weighted domain heatmap, weighted domain readiness bars, stat tiles (coverage, evidence, criticals, denials held), evidence-gap tracker, mission-thread readiness, and the Getting Started card for fresh events. All tiles and rows drill through. |
| **Event Workspace** | Event profile (name, location, window, classification, phase, objectives, standards). Event Readiness Meter (8 planning inputs). Mission Threads. Protected Data Objects. Participants & Systems (with CSV import). Compliance Weights. Daily Log / Hotwash. |
| **DCS Checklist** | All 55 checklist items grouped by domain, with the maturity rubric strip at the top. Filters: search, domain, result, workflow, severity, missing evidence, owner, mission thread. Bulk assign. Drill-in drawer covers scoring, notes, mission-thread links, evidence links, and finding generation. CSV export. |
| **Test Cards** | Scenario library, stats (executed / passed / failed / outcome mismatches), filterable list, drill-in drawer with PDP/PEP results, latency, hotwash notes, and *Convert Failure to Finding*. |
| **Evidence Locker** | Typed evidence records with quality grade and optional file attachment (small files stored, larger ones referenced by name). Log Template + *⇪ Ingest Decision Log* for PDP/PEP/SIEM CSV / JSON / NDJSON with an audit reconstruction timeline. Export Evidence Index. |
| **Findings** | Severity (Critical / Major / Moderate / Observation / Strength), remediation status (Open / In Remediation / Risk Accepted / Closed), owner, due date, and clickable traceability chain. CSV export. |
| **Report Builder** | 11 selectable sections; assessor-owned Executive Narrative (optional AI-drafted). Print-ready output. CSV / JSON exports: Checklist, Findings, Evidence Index, Full Event, Workspace Backup. |
| **Program** | Cross-event: events table with phase / readiness / rating / coverage / evidence / open criticals; readiness trend; domain × event maturity matrix with first→latest deltas; reusable strengths library; program-wide open critical gaps. One-click *Reuse* to start the next event from any prior event's setup. |

### Scoring rubric (0–4 maturity)

| Score | Meaning |
|---|---|
| 0 — Not Observed | No evidence collected or capability not demonstrated |
| 1 — Manual / Ad Hoc | Outcome exists only through manual, informal, or inconsistent activity |
| 2 — Demonstrated | Outcome worked in a controlled event scenario |
| 3 — Integrated / Repeatable | Outcome worked across systems with repeatable process and evidence |
| 4 — Operationally Ready | Outcome worked under realistic mission conditions with audit trail and measurable value |

### DCS domains (default compliance weights)

| Code | Domain | Weight |
|---|---|---:|
| 5.1 | Scope, Authority & Use Cases | 4 % |
| 5.2 | Architecture & Control Points | 5 % |
| 5.3 | Asset Registration & Stewardship | 6 % |
| 5.4 | Labeling, Tagging & Security Metadata | **15 %** |
| 5.5 | Policy Model & Attribute Inputs | 12 % |
| 5.6 | Access Decision & Enforcement | **15 %** |
| 5.7 | Sharing, Release & Partner Controls | 10 % |
| 5.8 | Protection Controls | 8 % |
| 5.9 | Telemetry, Audit & Evidence | **15 %** |
| 5.10 | Operational Readiness & Scale | 10 % |

Weights are editable per event (Event Workspace → Compliance Weights).

### Findings severity model

| Severity | Definition |
|---|---|
| **Critical Gap** | Unauthorized access, release of non-releasable data, policy bypass, missing audit trail for sensitive access, label loss causing release risk, or enforcement failure that defaults open |
| **Major Gap** | Capability works only manually, inconsistently, or outside the operational workflow; policy is not explainable; evidence is incomplete for key tests |
| **Moderate Gap** | Capability works but lacks automation, scale, repeatability, resilience, or complete telemetry |
| **Observation** | Improvement, integration issue, usability concern, or future planning item that does not block the event objective |
| **Strength** | Capability, control pattern, evidence model, or operational workflow that should be preserved, reused, or scaled |

---

## Scoring engine and the critical gate

The overall readiness percentage is a **weighted blend of the domain averages**
(domain % = mean of scored items ÷ 4, blended by the compliance weights over
domains that have at least one scored item).

The overall **rating** applies the critical gate on top of the percentage:

| Overall % | Rating (when no critical gate is tripped) |
|---:|---|
| ≥ 85 % | Operationally Ready |
| 62.5–85 % | Integrated / Repeatable |
| 40–62.5 % | Demonstrated |
| < 40 % | Manual / Ad Hoc |

**The critical gate — no misleading green.** Regardless of the percentage, the
overall rating is capped at *"Not Ready — Critical Gap"* when any of these are
true:

- a checklist item marked *severity: critical* has a **Fail** result, or
- any Critical severity finding is in **Open / In Remediation / Risk Accepted** status.

The dashboard's readiness gauge card explains exactly which items or findings
tripped the gate and links directly to them. This is the tool's core opinion:
a demonstrated false allow or lost label matters more than a healthy-looking
average.

---

## Running a program of assessments

The app is built for a *series* of assessments over time, not a single event.

- Every event carries an **assessment phase**, shown as a chip in the top bar.
- **Reuse as Template** (Events ▾ or the Program view) clones an existing
  event's scope, threads, assets, weights, assignments, and test cards with
  all scores / evidence / findings cleared — ready for the next event.
- The **Program view** compares events over time: is maturity improving, which
  domains keep lagging, which critical gaps are still open anywhere in the
  program, and which strength patterns should be reused.
- **Event JSON export / import** moves individual events between machines or
  archives them.
- **Workspace backup / restore** (⬇ Backup Workspace / Events ▾ → Import JSON)
  moves the entire program.

---

## Docker deployment and configuration

### What Docker mode adds over standalone

- **Shared team workspace.** The workspace lives on the server, not per-browser,
  so multiple assessors work from one store during the same event.
- **Persistence beyond the browser.** The `/data` volume survives container
  restarts, image rebuilds, and browser cache clears.
- **Concurrency safety.** Every save carries the revision it was based on; a
  stale save gets `409` and the client re-syncs instead of clobbering a
  teammate's work.
- **Offline tolerance.** If the server drops, changes are kept in the browser
  and resync when it returns. The user is told both ways.
- **Automatic sync.** Browsers poll every 15 s to pick up others' changes
  (politely deferred while an editor is open).

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `8080` | HTTP listen port |
| `DATA_DIR` | `/data` | Where `workspace.json` is stored |
| `BASIC_AUTH_USER` | *(unset)* | Enable HTTP Basic Auth by setting user + pass |
| `BASIC_AUTH_PASS` | *(unset)* | Password used with `BASIC_AUTH_USER` |

By default there is no authentication — run on a trusted network or front it
with your own reverse proxy and TLS. `docker-compose.yml` has commented-out
Basic Auth environment variables ready to enable.

### HTTP API

The frontend uses this API; anything that speaks JSON can too.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | Liveness probe + current revision |
| `GET` | `/api/revision` | Current revision (used for polling) |
| `GET` | `/api/workspace` | Full workspace `{ revision, state, savedAt }` |
| `PUT` | `/api/workspace` | Body `{ revision, state }`. Returns `200` on save, `409` on stale revision |

### Backups

The workspace file is `/data/workspace.json` on the mounted volume:

```bash
docker cp dcs-command-center:/data/workspace.json ./backup-$(date +%F).json
```

You can also use **⬇ Backup Workspace** in the sidebar (downloads a JSON that
the same or another instance can re-import via *Events ▾ → Import JSON*).

### Container hygiene

- Base image: `node:22-alpine`, zero external `npm` dependencies.
- Runs as a non-root user (`dcs`).
- Healthcheck: `GET /api/health` every 30 s.
- Body size cap: 64 MB (evidence attachments arrive as base64 data URLs).
- Path traversal is blocked at the server; unknown API paths return `404`.

---

## Data model and integrations

### Core objects

| Object | Purpose |
|---|---|
| `events` | Every assessment event: profile, phase, participants, systems, weights |
| `mission_threads` | Operational scenarios tied to protected assets and expected outcomes |
| `protected_objects` | Datasets, APIs, files, feeds, messages, data products |
| `checklist_items` | The 55 white-paper checks per event, with score / result / workflow / evidence links |
| `test_cards` | Scenario tests with expected vs. actual DCS outcome |
| `evidence` | Screenshots, logs, exports, observations, decision-record ingests |
| `findings` | Gaps, risks, strengths — with owners, due dates, and traceability |
| `daily_rollups` | On-site execution summaries |
| `standards_mapping` | Per-item mapping to DoD ZT / NIST / CISA / NSA guidance |

### Bulk loading (CSV)

Event Workspace → **Participants** and → **Protected Data Objects** each have
*CSV Template* (downloads the reference columns with an example row) and
*Import CSV* buttons. Rows missing a `name` are skipped and reported.

### Decision-log ingestion

Evidence Locker → **⇪ Ingest Decision Log** imports a PDP / PEP / SIEM export
as a Decision Record evidence item.

- **Formats:** CSV, JSON array, `{records: [...]}`, or NDJSON.
- **Column aliases** are recognized so exports from different tools normalize
  into the assessment schema: `@timestamp` / `principal` / `resource` /
  `outcome` from a SIEM map the same as `timestamp` / `user` / `asset` /
  `decision` from a gateway. Additional recognized aliases include
  `expected_outcome`, `reason` / `policy_id`, `pep_result`,
  `decision_latency_ms`.
- **Auto-summary** on ingest: allows, denies, redact/mask/filter outcomes,
  distinct users and assets, average decision latency, time window.
- **Expected-vs-actual detection.** When the export carries an expected column,
  mismatches are counted and a **possible false allow** (expected deny,
  observed allow) is flagged loudly, pointing at DCS-31 — the white paper's
  "immediate escalation" red flag.
- **Audit Reconstruction timeline** in the evidence drawer: filterable
  chronological table (text filter, mismatches / allows / denies only), with
  mismatch rows highlighted.
- Ingests are capped at 3,000 records per file to protect browser storage —
  filter exports to the event window first.

---

## Optional local AI drafting

**✦ Local AI** (sidebar) connects the app to a model running on the same
machine via [Ollama](https://ollama.com). Nothing is sent to any cloud service.

When enabled it can:

- **Draft finding impact & recommendation** — in the finding editor, grounded
  in the linked checklist requirements, expected-vs-actual test outcomes,
  evidence records, and your notes.
- **Draft the executive narrative** — in the Report Builder, grounded strictly
  in the event's recorded scores and findings (the prompt says: do not invent
  facts not present).

**Guardrail by design:** the assistant only writes into editable draft fields.
It never scores items, never changes results, never certifies compliance. Every
insert shows a *"review and edit before saving"* reminder.

**Setup:**

1. Install [Ollama](https://ollama.com) and `ollama pull llama3.1` (or your
   preferred local model).
2. Serve the app over `http://localhost` — not `file://` — so the browser
   allows the local request (Docker mode handles this).
3. Sidebar → **✦ Local AI** → tick *Enable local AI drafting*, click
   **Test Connection**, then Save.

---

## Data safety and backup

- **Docker mode:** the workspace persists in the `/data` volume on the server;
  browsers keep a local offline cache. Use **⬇ Backup Workspace** and/or
  `docker cp` for point-in-time backups. **Events ▾ → Import JSON** restores.
- **Standalone mode:** data lives in browser `localStorage` (~5 MB per origin).
  The sidebar footer shows the last backup age and the Events menu shows
  current storage usage. Larger evidence files (over ~1.5 MB) are referenced by
  name rather than stored, so you can point at the local evidence folder for
  the on-site copy.
- The workspace is a plain JSON file. Nothing about the format requires this
  tool to read it — you can inspect it, diff it between events, or pipe it into
  other analysis.

---

## Roadmap

### Delivered

- ✅ Full DCS Framework content library (55 items, 10 domains, severities, red
  flags, roadmap, execution model)
- ✅ Executive Dashboard with critical gate and drill-in throughout
- ✅ Event Workspace with phase lifecycle and readiness meter
- ✅ 0–4 maturity scoring with per-event compliance weights
- ✅ Scenario test cards with expected vs. actual outcomes and a 10-scenario
  library
- ✅ Evidence Locker with chain-of-custody metadata and file attachments
- ✅ Findings with full mission-thread → check → test → evidence traceability
- ✅ Print-ready Report Builder + CSV / JSON exports
- ✅ Program view — cross-event maturity trend, matrix, reusable-strengths
  library
- ✅ Bulk CSV import for participants and protected data objects
- ✅ Optional local AI drafting (Ollama) for findings and the executive
  narrative
- ✅ Decision-log ingestion (CSV / JSON / NDJSON) with audit reconstruction
  timeline and false-allow detection
- ✅ Docker-hosted deployment with shared, server-persisted workspace and
  concurrency-safe sync
- ✅ Standalone browser mode preserved as a first-class option
- ✅ Optional HTTP Basic Auth
- ✅ Light / dark themes; accessible palette (validated); print stylesheet
- ✅ Non-root Docker image with healthcheck

### Planned

Rough priority order — say the word to promote any of these:

- ⬜ **Role-based access control** — per-user login and Assessment Lead /
  Assessor / Steward / SME / Leadership Viewer permissions enforced by the
  server. (Natural next step now that a server exists.)
- ⬜ **Auto-matching ingested log records to test cards** — attach relevant
  decision-log slices to each test card by scenario / requestor / asset.
- ⬜ **Word (.docx) report export** — in addition to Print / PDF.
- ⬜ **Approval / sign-off gates** — Assessment Lead sign-off before findings
  or the final report are marked final.
- ⬜ **Live SIEM / API pull** — poll a configured log endpoint during
  execution instead of manual file imports.
- ⬜ **Label persistence validator** — structured before/after label comparison
  with automatic pass/fail scoring for DCS-19 / DCS-37.
- ⬜ **Timeline-based audit reconstruction playback** — replay decision events
  scrubbing forward through time.
- ⬜ **Multi-user real-time presence** — live cursors and "who's editing what"
  indicators.
- ⬜ **Postgres storage backend** — optional swap-in for `workspace.json` when
  the program grows beyond what a single JSON file wants to hold.
- ⬜ **PR-style history / audit log** — server-side change history with author
  attribution.

### Out of scope on purpose

- Automatic compliance certification. The AI drafts; the assessor certifies.
- Sending data to third-party cloud services by default.
- Anything that requires an internet connection during a restricted on-site
  event.

---

## Standards references

- **NIST SP 800-207** — Zero Trust Architecture
- **DoD Zero Trust Strategy & Capability Execution Roadmap**
- **NIST SP 800-53 Rev. 5** — control families mapped per checklist item
  (AC, AU, IA, SC, SI, RA, PL, CM, CP, PM, PS)
- **CISA Zero Trust Maturity Model v2** — Data Pillar
- **NSA CSI** — *Advancing Zero Trust Maturity Throughout the Data Pillar*
- **DoD Data Strategy (2020)**

Every checklist item carries its own standards mapping, visible in the item
drawer and included in the report's Standards Coverage section.

---

## Repository layout

```
index.html            App shell (plain script tags — works from file://)
server.js             Zero-dependency Node server: static app +
                      shared-workspace API with revision-based conflict
                      detection
Dockerfile            Container image (node:22-alpine, non-root, healthcheck)
docker-compose.yml    One-command team deployment with a persistent volume
.dockerignore         Excludes docs, git, and markdown from the image
css/app.css           Styling, light/dark themes, print stylesheet
js/template.js        The reusable assessment template: 10 domains, 55
                      checklist items, rubric, severities, test-card
                      library, roadmap, phases
js/store.js           State, persistence (server-synced or localStorage),
                      scoring engine, CSV parsing, exports
js/ui.js              DOM builders, modal / drawer / toast primitives
js/charts.js          Gauge, heatmap, bar rows (accessible, palette-validated)
js/assistant.js       Optional local-AI drafting (Ollama)
js/view-dashboard.js  Executive Dashboard
js/view-event.js      Event Workspace (profile, threads, assets, people,
                      weights, daily log)
js/view-checklist.js  DCS Checklist with filters, drawer, bulk assign
js/view-testcards.js  Test Cards with the scenario library
js/view-evidence.js   Evidence Locker + decision-log ingestion
js/view-findings.js   Findings with traceability chain
js/view-reports.js    Report Builder
js/view-program.js    Cross-event Program view
js/app.js             Shell, routing, sidebar, event / theme / AI controls
docs/screenshots/     Product screenshots used in this README
```

---

## Development

The app is intentionally build-step free: plain HTML, CSS, and script tags. To
work on it:

```bash
# static mode
python3 -m http.server 8080

# or with the API server
node server.js                 # listens on :8080, writes to ./data
```

Syntax-check the JS:

```bash
for f in js/*.js server.js; do node --check "$f"; done
```

End-to-end verification uses Playwright (Chromium) from a scratchpad — see the
`drive*.js` scripts in the local scratch directory for the recorded checks
(dashboard render, checklist drawer save, log ingestion, two-browser shared
workspace, Basic Auth). All commits to this branch have been verified this way
against the built Docker image.

### Design system

Chart palette follows the validated reference data-viz palette (light and
dark modes, CVD-safe categorical ordering, sequential blue for magnitude,
reserved status colors). See `js/charts.js` and `css/app.css`.

### Contributing

Development happens on branch `claude/dcs-checklist-compliance-app-2sq8k1`;
pull request [`#1`](https://github.com/echofoxx/DCS-Compliance/pull/1) is the
current thread of work.
