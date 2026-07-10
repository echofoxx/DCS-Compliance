# DCS Assessment Command Center

A **local-first web application** for planning, executing, scoring, and reporting
**Data-Centric Security (DCS) compliance assessments** during operational events.

It is an assessment command center, not a basic checklist. The app is built to answer
one core question:

> **Did the event prove that protected data can be discovered, labeled, governed,
> accessed, denied, shared, monitored, and audited under Zero Trust conditions?**

The assessment content is drawn from the *DCS Assessment Framework* white paper:
**55 compliance checks (DCS-01 … DCS-55) across 10 DCS domains**, a 0–4 maturity
rubric, a findings severity model with red-flag gating, a test-card evidence schema,
and the 30/60/90/180-day reporting roadmap.

---

## Running the app

No build step, no server, no network dependency — by design, so it can run on-site
in restricted environments.

**Option 1 — open directly**

Open `index.html` in any modern browser (Chrome, Edge, Firefox).

**Option 2 — local web server** (recommended for daily use so browser storage is
tied to a stable origin)

```bash
python3 -m http.server 8080
# then browse to http://localhost:8080
```

**Option 3 — Docker**

```bash
docker run -d -p 8080:80 -v "$PWD":/usr/share/nginx/html:ro nginx:alpine
```

All data is stored in the browser's `localStorage`. Nothing ever leaves the machine.
Use **Report Builder → Workspace Backup (JSON)** to back up or move data between
machines, and **Events ▾ → Import JSON** to restore.

> A pre-populated **sample event** loads on first run so every screen has data.
> Delete it from **Events ▾ → Delete Event** once you create your own.

---

## The modules

| Module | What it does |
|---|---|
| **Dashboard** | Readiness gauge, weighted domain heatmap, evidence-gap tracker, mission-thread status, critical findings — with click-through drill-in everywhere |
| **Event Workspace** | Event profile, readiness meter, mission threads, protected data objects, participants, systems in scope, compliance weights, daily hotwash log |
| **DCS Checklist** | The 55-item white-paper checklist grouped by domain, with filters (domain, result, workflow, severity, evidence, owner, thread), bulk assignment, and a drill-in drawer for scoring, evidence linking, and finding generation |
| **Test Cards** | Scenario tests with expected vs. actual DCS outcome, PDP/PEP results and reason codes, decision/enforcement latency, hotwash notes, and one-click "convert failure to finding". Includes a library of 10 proven scenario patterns (denial test, label persistence, bypass attempt, bulk export, revocation, audit reconstruction…) |
| **Evidence Locker** | Evidence records with type, source system, captured-by, timestamp, classification/handling, quality grade, optional file attachment, and links to checklist items, test cards, and findings. Exportable evidence index |
| **Findings** | Severity (Critical / Major / Moderate / Observation / Strength), impact, recommendation, owner, due date, remediation status — plus the full traceability chain |
| **Report Builder** | Print-ready final assessment report (executive summary, scope, methodology, scorecard, detailed results, expected-vs-actual tests, findings, standards coverage, evidence index, daily rollups, roadmap) plus CSV/JSON exports |

## Scoring & compliance engine

- Items are scored on the **0–4 maturity rubric** (Not Observed → Operationally Ready)
  with a Pass / Partial / Fail / Not-Observed / N/A result.
- Domain average → weighted overall readiness using **per-event editable domain weights**
  (defaults follow the framework's emphasis on labeling, policy, enforcement, and audit).
- **Critical gate — no misleading green:** a failed critical checklist item (false allow,
  label loss, bypass, fails-open, unexplainable decision, missing audit) or any open
  Critical finding caps the overall rating at *Not Ready — Critical Gap* regardless of
  the weighted score.
- **Evidence completeness** is tracked separately: a scored item without linked evidence
  is flagged as indefensible on the dashboard.

## Traceability — the differentiator

Every finding traces end-to-end, and each step is clickable:

```
Mission Thread → Protected Object → Checklist Item → Test Card → Evidence → Score → Finding → Recommendation
```

## Reusable across events

- Every **new event** instantiates a fresh, unscored copy of the 55-item template.
- **Reuse as Template** (Events ▾) clones an existing event's scope, threads, assets,
  weights, assignments, and test cards with all scores/evidence/findings cleared —
  ready for the next event.
- **Event JSON export/import** moves events between machines or archives them.

## Repository layout

```
index.html            App shell (plain script tags — works from file://)
css/app.css           Styling, light/dark themes, print stylesheet
js/template.js        The reusable assessment template: domains, 55 checklist
                      items, rubric, severities, test-card library, roadmap
js/store.js           State, localStorage persistence, scoring engine, exports
js/ui.js              DOM builders, modal/drawer/toast primitives
js/charts.js          Gauge, heatmap, bar rows (accessible, palette-validated)
js/view-*.js          One file per screen
```

## Standards references

- NIST SP 800-207, *Zero Trust Architecture*
- DoD Zero Trust Strategy & Capability Execution Roadmap
- NIST SP 800-53 Rev. 5 control families (mapped per checklist item)
- CISA Zero Trust Maturity Model v2 (Data Pillar)
- NSA CSI, *Advancing Zero Trust Maturity Throughout the Data Pillar*
- DoD Data Strategy (2020)

## Roadmap (post-MVP candidates)

API ingestion from SIEM/gateway/PDP logs · automated evidence validation ·
role-based workflow approvals · cross-event maturity comparison · label
persistence validator · audit reconstruction timeline · optional local AI
(Ollama) for drafting findings and executive summaries — drafting only,
never auto-certifying compliance.
