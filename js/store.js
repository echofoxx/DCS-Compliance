/* =========================================================================
 * DCS Assessment Command Center — Store
 * State management, localStorage persistence, scoring engine, import/export.
 * Local-first by design: all data lives in the browser; a full event (or the
 * whole workspace) can be exported/imported as JSON for transfer or backup.
 * ========================================================================= */

"use strict";

const Store = (() => {
  const LS_KEY = "dcs_command_center_v1";
  let state = null;
  const listeners = [];

  /* ------------------------------------------------------------ utilities */
  const uid = (prefix) =>
    `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

  const nowISO = () => new Date().toISOString();
  const clone = (o) => JSON.parse(JSON.stringify(o));

  /* --------------------------------------------------------- event factory */
  function newChecklistFromTemplate() {
    return DCS_TEMPLATE.CHECKLIST.map((t) => ({
      id: t.id,
      score: null,               // 0-4 or null (unscored)
      result: null,              // pass | partial | fail | no | na
      workflow: "not_started",   // not_started | in_progress | complete | blocked
      assignee: "",
      missionThreadIds: [],
      notes: "",
      evidenceIds: [],
      findingIds: [],
      updatedAt: null
    }));
  }

  function newEvent(fields = {}) {
    return Object.assign({
      id: uid("EVT"),
      name: "New DCS Assessment Event",
      phase: "planning",
      location: "",
      classification: "UNCLASSIFIED",
      eventWindow: "",
      assessmentPeriod: "",
      description: "",
      organizations: [],
      objectives: [],
      standards: DCS_TEMPLATE.STANDARDS_OPTIONS.slice(0, 5),
      participants: [],           // {id, name, org, role, email}
      systems: [],                // {id, name, layer, owner, notes}
      missionThreads: [],         // {id, name, operationalUser, partnerUser, assetIds, dcsAction, expectedOutcome, notes, status}
      assets: [],                 // protected data objects
      domainWeights: Object.fromEntries(DCS_TEMPLATE.DOMAINS.map((d) => [d.id, d.weight])),
      checklist: newChecklistFromTemplate(),
      testCards: [],
      evidence: [],
      findings: [],
      dailyLogs: [],
      createdAt: nowISO(),
      isSample: false
    }, fields);
  }

  /* --------------------------------------------------------- sample event */
  function buildSampleEvent() {
    const ev = newEvent({
      name: "DCS/ZT Operational Demonstration (Sample)",
      location: "Honolulu, HI",
      classification: "UNCLASSIFIED",
      eventWindow: "October 2026 (on-site execution)",
      assessmentPeriod: "July – December 2026",
      description: "Sample event pre-populated to demonstrate the workbench. Delete it once you create your own event, or clear its data and reuse it.",
      organizations: ["JS J6", "DISA", "Service Components", "Coalition Mission Partners"],
      objectives: [
        "Prove machine-readable security labeling and label persistence",
        "Prove policy-driven allow / deny / redact decisions with reason codes",
        "Prove mission partner releasable-subset sharing and non-release denial",
        "Prove auditable reconstruction of access and sharing decisions"
      ],
      isSample: true,
      phase: "execution"
    });

    // participants
    ev.participants = [
      { id: uid("P"), name: "A. Ramirez", org: "JS J6", role: "Assessment Lead", email: "" },
      { id: uid("P"), name: "K. Osei",    org: "DISA",  role: "DCS Control Assessor", email: "" },
      { id: uid("P"), name: "M. Tanaka",  org: "Coalition LNO", role: "Partner / Coalition SME", email: "" },
      { id: uid("P"), name: "J. Whitfield", org: "Service Component", role: "Data Steward", email: "" }
    ];

    // systems
    ev.systems = [
      { id: uid("SYS"), name: "Mission Data Platform", layer: "Application / API", owner: "Service Component", notes: "System of record for the operational picture." },
      { id: uid("SYS"), name: "API Gateway (PEP)", layer: "Gateway", owner: "DISA", notes: "Primary enforcement point for data product access." },
      { id: uid("SYS"), name: "Policy Engine (PDP)", layer: "Platform", owner: "DISA", notes: "Attribute-based policy decision service with reason codes." },
      { id: uid("SYS"), name: "SIEM / Telemetry Store", layer: "Platform", owner: "JS J6", notes: "Collects PDP/PEP decision and enforcement logs." }
    ];

    // protected assets
    const a1 = { id: uid("AST"), name: "Common Operational Picture (COP) Feed", type: "Data feed / API",
      owner: "J3 Operations", steward: "J. Whitfield", sourceSystem: "Mission Data Platform",
      classification: "UNCLASSIFIED//FOUO", releasability: "REL TO USA, Coalition Partners (subset)",
      caveats: "Restricted fields: sensor source, unit readiness", missionTags: "COP, Coalition Sharing",
      protections: ["Field-level redaction", "Encryption in transit", "Export control"], riskRating: "High", notes: "" };
    const a2 = { id: uid("AST"), name: "Logistics Status Data Product", type: "Data product",
      owner: "J4 Logistics", steward: "J. Whitfield", sourceSystem: "Mission Data Platform",
      classification: "CUI", releasability: "REL TO USA only",
      caveats: "No partner release", missionTags: "Sustainment",
      protections: ["Encryption at rest", "DLP export control"], riskRating: "Moderate", notes: "" };
    ev.assets = [a1, a2];

    // mission threads
    const mt1 = { id: uid("MT"), name: "Coalition Operational Data Sharing",
      operationalUser: "U.S. watch officer", partnerUser: "Coalition mission partner",
      assetIds: [a1.id], dcsAction: "Allow releasable subset; deny restricted fields",
      expectedOutcome: "Partner sees authorized information only", notes: "", status: "in_progress" };
    const mt2 = { id: uid("MT"), name: "Dynamic Access Under Changing Mission Role",
      operationalUser: "U.S. planner (role changes mid-event)", partnerUser: "",
      assetIds: [a2.id], dcsAction: "Revoke access after role change",
      expectedOutcome: "Access removed within assessed timeframe", notes: "", status: "not_started" };
    const mt3 = { id: uid("MT"), name: "Audit Reconstruction of Sharing Decisions",
      operationalUser: "Assessment team analyst", partnerUser: "",
      assetIds: [a1.id, a2.id], dcsAction: "Reconstruct access timeline from exports",
      expectedOutcome: "Every decision traceable to policy with reason code", notes: "", status: "not_started" };
    ev.missionThreads = [mt1, mt2, mt3];

    // evidence
    const evd = (title, type, source, quality, desc) => ({
      id: uid("EVD"), title, type, sourceSystem: source, capturedBy: "K. Osei",
      capturedAt: nowISO(), classification: "UNCLASSIFIED", quality,
      description: desc, fileName: "", fileDataUrl: "", fileSize: 0,
      links: { checklist: [], testCards: [], findings: [] }
    });
    const e1 = evd("PDP decision log — partner subset request", "Log File", "Policy Engine (PDP)", "strong",
      "JSON decision output with reason code REL-SUBSET-021 for coalition partner COP request.");
    const e2 = evd("Denied request screenshot — restricted fields", "Screenshot", "API Gateway (PEP)", "strong",
      "Gateway response showing 403 with policy reason code for non-releasable field request.");
    const e3 = evd("Before/after label comparison — COP transfer", "Data Sample / Metadata", "API Gateway (PEP)", "moderate",
      "Label set exported before and after gateway hop. Mission tag preserved; handling caveat field dropped on transform.");
    const e4 = evd("DCS label schema v1.2", "Architecture Artifact", "Program Office", "strong",
      "Approved schema: classification, releasability, caveats, sensitivity, mission tag, source.");
    ev.evidence = [e1, e2, e3, e4];

    // score a representative set of checklist items
    const setItem = (id, score, result, workflow, evidenceIds = [], notes = "") => {
      const it = ev.checklist.find((c) => c.id === id);
      it.score = score; it.result = result; it.workflow = workflow;
      it.evidenceIds = evidenceIds; it.notes = notes; it.updatedAt = nowISO();
      it.assignee = "K. Osei";
      evidenceIds.forEach((eid) => {
        const rec = ev.evidence.find((x) => x.id === eid);
        if (rec && !rec.links.checklist.includes(id)) rec.links.checklist.push(id);
      });
    };
    setItem("DCS-01", 3, "pass", "complete");
    setItem("DCS-02", 3, "pass", "complete");
    setItem("DCS-04", 4, "pass", "complete");
    setItem("DCS-06", 3, "pass", "complete");
    setItem("DCS-11", 2, "partial", "complete", [], "Register complete for event assets; risk ratings missing for two feeds.");
    setItem("DCS-12", 3, "pass", "complete");
    setItem("DCS-16", 4, "pass", "complete", [e4.id]);
    setItem("DCS-17", 3, "pass", "complete", [e1.id]);
    setItem("DCS-18", 3, "pass", "in_progress");
    setItem("DCS-19", 1, "fail", "complete", [e3.id], "Handling caveat dropped when COP product transits the gateway transform step.");
    setItem("DCS-24", 3, "pass", "complete", [e1.id]);
    setItem("DCS-28", 3, "pass", "complete", [e1.id]);
    setItem("DCS-30", 3, "pass", "complete");
    setItem("DCS-31", 4, "pass", "complete", [e2.id]);
    setItem("DCS-35", 3, "pass", "in_progress", [e1.id]);
    setItem("DCS-36", 3, "pass", "complete", [e2.id]);
    setItem("DCS-45", 2, "partial", "in_progress", [], "Decision logs complete; device attribute missing from PEP records.");
    setItem("DCS-46", 3, "pass", "complete", [e2.id]);
    setItem("DCS-51", 2, "partial", "in_progress", [], "Operators used the managed path, but two asked for email export due to latency.");

    // test cards
    const tc = (libIndex, overrides) => {
      const lib = DCS_TEMPLATE.TEST_CARD_LIBRARY[libIndex];
      return Object.assign({
        id: uid("TC"), title: lib.title, dcsUseCase: lib.dcsUseCase, scenario: lib.scenario,
        missionThreadId: "", assetId: "", requestor: "", requestorAttributes: "",
        accessAction: lib.accessAction, expectedOutcome: lib.expectedOutcome,
        actualOutcome: "", pdpResult: "", pepResult: "",
        decisionLatencyMs: null, enforcementLatencyMs: null,
        score: null, result: null, day: "", hotwashNotes: "",
        checklistIds: lib.checklistIds.slice(), evidenceIds: [], createdAt: nowISO()
      }, overrides);
    };
    const t1 = tc(0, { missionThreadId: mt1.id, assetId: a1.id, requestor: "U.S. watch officer",
      requestorAttributes: "US person; J3 role; SIPR-equivalent device posture; mission COI: COP",
      actualOutcome: "allow", pdpResult: "PERMIT (reason: ROLE-J3-COP)", pepResult: "Served full product",
      decisionLatencyMs: 120, enforcementLatencyMs: 40, score: 3, result: "pass", day: "Day 3",
      evidenceIds: [e1.id] });
    const t2 = tc(1, { missionThreadId: mt1.id, assetId: a1.id, requestor: "Coalition partner (no REL)",
      requestorAttributes: "Partner nation X; no releasability for restricted fields",
      actualOutcome: "deny", pdpResult: "DENY (reason: REL-NOMATCH-004)", pepResult: "403 returned; logged",
      decisionLatencyMs: 95, enforcementLatencyMs: 30, score: 4, result: "pass", day: "Day 3",
      evidenceIds: [e2.id] });
    const t3 = tc(3, { missionThreadId: mt1.id, assetId: a1.id, requestor: "System-to-system transfer",
      actualOutcome: "allow", pdpResult: "PERMIT", pepResult: "Transfer completed; caveat field dropped",
      score: 1, result: "fail", day: "Day 4",
      hotwashNotes: "Gateway transform strips non-schema fields. Caveat must map into the target schema.",
      evidenceIds: [e3.id] });
    t1.evidenceIds.forEach((id) => ev.evidence.find((x) => x.id === id).links.testCards.push(t1.id));
    t2.evidenceIds.forEach((id) => { const r = ev.evidence.find((x) => x.id === id); if (!r.links.testCards.includes(t2.id)) r.links.testCards.push(t2.id); });
    t3.evidenceIds.forEach((id) => { const r = ev.evidence.find((x) => x.id === id); if (!r.links.testCards.includes(t3.id)) r.links.testCards.push(t3.id); });
    ev.testCards = [t1, t2, t3];

    // findings
    const f1 = { id: uid("FND"), title: "Security label caveat lost during gateway transform",
      severity: "critical", domainId: "D04",
      impact: "Releasability decisions downstream of the gateway cannot be trusted; restricted fields could be released to partners.",
      recommendation: "Preserve the full label set in gateway transform mapping; add a label-integrity check that quarantines products with dropped fields.",
      owner: "System integrator", dueDate: "", status: "open",
      evidenceIds: [e3.id], checklistIds: ["DCS-19"], testCardIds: [t3.id],
      missionThreadId: mt1.id, notes: "", createdAt: nowISO() };
    const f2 = { id: uid("FND"), title: "PEP audit records missing device attribute",
      severity: "major", domainId: "D09",
      impact: "Post-event reconstruction cannot confirm device posture for enforcement decisions.",
      recommendation: "Add device posture claim to the PEP log schema before Day 5 audit reconstruction test.",
      owner: "DISA telemetry team", dueDate: "", status: "in_remediation",
      evidenceIds: [], checklistIds: ["DCS-45"], testCardIds: [],
      missionThreadId: "", notes: "", createdAt: nowISO() };
    const f3 = { id: uid("FND"), title: "Reason codes make denials operator-actionable",
      severity: "strength", domainId: "D06",
      impact: "Operators and assessors could immediately interpret every denial; no support tickets were raised for blocked requests.",
      recommendation: "Preserve the reason-code pattern and reuse it across all PEPs when scaling.",
      owner: "Assessment Lead", dueDate: "", status: "closed",
      evidenceIds: [e2.id], checklistIds: ["DCS-52"], testCardIds: [t2.id],
      missionThreadId: mt1.id, notes: "", createdAt: nowISO() };
    ev.findings = [f1, f2, f3];
    ev.checklist.find((c) => c.id === "DCS-19").findingIds.push(f1.id);
    ev.checklist.find((c) => c.id === "DCS-45").findingIds.push(f2.id);
    e3.links.findings.push(f1.id);
    e2.links.findings.push(f3.id);

    // daily log
    ev.dailyLogs = [
      { id: uid("DL"), day: "Day 3", date: "", focus: "Decision and enforcement",
        summary: "Executed allow/deny/redact test set against COP feed. 15 of 15 unauthorized attempts blocked.",
        issues: "Gateway transform label loss discovered during transfer test.",
        decisions: "Escalated label loss as critical finding; integrator to prototype fix before Day 5.",
        actions: "Re-run label persistence test after fix; capture before/after metadata exports." }
    ];

    return ev;
  }

  /* ---------------------------------------------------------- persistence */
  function defaultState() {
    const sample = buildSampleEvent();
    return { version: 1, activeEventId: sample.id, events: [sample],
      settings: { theme: "auto" }, lastBackupAt: null };
  }

  // Bring older stored states up to the current shape without losing data.
  function migrate(st) {
    if (st.lastBackupAt === undefined) st.lastBackupAt = null;
    if (!st.settings) st.settings = { theme: "auto" };
    st.events.forEach((ev) => {
      if (!ev.phase) ev.phase = ev.isSample ? "execution" : "planning";
      if (!ev.dailyLogs) ev.dailyLogs = [];
      if (!ev.domainWeights) ev.domainWeights = Object.fromEntries(DCS_TEMPLATE.DOMAINS.map((d) => [d.id, d.weight]));
      // pick up checklist items added to the template after the event was created
      DCS_TEMPLATE.CHECKLIST.forEach((t) => {
        if (!ev.checklist.some((c) => c.id === t.id)) {
          ev.checklist.push({ id: t.id, score: null, result: null, workflow: "not_started",
            assignee: "", missionThreadIds: [], notes: "", evidenceIds: [], findingIds: [], updatedAt: null });
        }
      });
    });
    return st;
  }

  function load() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      state = raw ? migrate(JSON.parse(raw)) : defaultState();
    } catch (e) {
      console.error("State load failed, starting fresh:", e);
      state = defaultState();
    }
    if (!state.events.length) {
      const ev = newEvent();
      state.events.push(ev);
      state.activeEventId = ev.id;
    }
    save();
  }

  function save() {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(state));
    } catch (e) {
      // Most likely quota exceeded from large evidence attachments.
      if (typeof UI !== "undefined" && UI.toast) {
        UI.toast("Storage limit reached — remove large evidence attachments or export/backup your data.", "error");
      }
      console.error("Save failed:", e);
    }
    listeners.forEach((fn) => fn());
  }

  const subscribe = (fn) => listeners.push(fn);

  /* ------------------------------------------------------------- accessors */
  const getState = () => state;
  const activeEvent = () => state.events.find((e) => e.id === state.activeEventId) || state.events[0];
  const templateItem = (id) => DCS_TEMPLATE.CHECKLIST.find((t) => t.id === id);
  const domain = (id) => DCS_TEMPLATE.DOMAINS.find((d) => d.id === id);

  function setActiveEvent(id) { state.activeEventId = id; save(); }

  function addEvent(fields) {
    const ev = newEvent(fields);
    state.events.push(ev);
    state.activeEventId = ev.id;
    save();
    return ev;
  }

  function deleteEvent(id) {
    state.events = state.events.filter((e) => e.id !== id);
    if (!state.events.length) state.events.push(newEvent());
    if (state.activeEventId === id) state.activeEventId = state.events[0].id;
    save();
  }

  function duplicateEventAsTemplate(id) {
    // Reuse an event's setup (scope, threads, assets, weights) with a fresh,
    // unscored checklist — the "reusable for different events" path.
    const src = state.events.find((e) => e.id === id);
    if (!src) return null;
    const copy = clone(src);
    copy.id = uid("EVT");
    copy.name = `${src.name} (Copy)`;
    copy.isSample = false;
    copy.createdAt = nowISO();
    copy.checklist = newChecklistFromTemplate();
    // carry over assignees & thread links from the source checklist
    src.checklist.forEach((s) => {
      const t = copy.checklist.find((c) => c.id === s.id);
      if (t) { t.assignee = s.assignee; t.missionThreadIds = s.missionThreadIds.slice(); }
    });
    copy.testCards = src.testCards.map((t) => Object.assign(clone(t), {
      id: uid("TC"), actualOutcome: "", pdpResult: "", pepResult: "",
      decisionLatencyMs: null, enforcementLatencyMs: null,
      score: null, result: null, hotwashNotes: "", evidenceIds: [], createdAt: nowISO()
    }));
    copy.evidence = [];
    copy.findings = [];
    copy.dailyLogs = [];
    copy.checklist.forEach((c) => { c.evidenceIds = []; c.findingIds = []; });
    state.events.push(copy);
    state.activeEventId = copy.id;
    save();
    return copy;
  }

  /* -------------------------------------------------------- scoring engine */
  // An item counts toward scoring when it is applicable (result !== 'na')
  // and has a score. Domain % = mean(score)/4. Overall = weight-blended
  // domain %, over domains that have at least one scored item.
  function computeScores(ev) {
    const domains = DCS_TEMPLATE.DOMAINS.map((d) => {
      const items = ev.checklist.filter((c) => templateItem(c.id).domainId === d.id);
      const applicable = items.filter((c) => c.result !== "na");
      const scored = applicable.filter((c) => c.score !== null && c.result !== "no");
      const avg = scored.length ? scored.reduce((s, c) => s + c.score, 0) / scored.length : null;
      const withEvidence = applicable.filter((c) => c.evidenceIds.length > 0).length;
      return {
        id: d.id, name: d.name, short: d.short,
        weight: ev.domainWeights[d.id] ?? d.weight,
        itemCount: items.length,
        applicable: applicable.length,
        scoredCount: scored.length,
        avgScore: avg,                       // 0-4 or null
        pct: avg === null ? null : avg / 4,  // 0-1 or null
        evidencePct: applicable.length ? withEvidence / applicable.length : 0,
        failures: applicable.filter((c) => c.result === "fail").length
      };
    });

    const rated = domains.filter((d) => d.pct !== null);
    const wSum = rated.reduce((s, d) => s + d.weight, 0);
    const overallPct = wSum ? rated.reduce((s, d) => s + d.pct * d.weight, 0) / wSum : null;

    const allApplicable = ev.checklist.filter((c) => c.result !== "na");
    const allScored = allApplicable.filter((c) => c.score !== null && c.result !== "no");
    const coverage = allApplicable.length ? allScored.length / allApplicable.length : 0;
    const evidenceCompleteness = allApplicable.length
      ? allApplicable.filter((c) => c.evidenceIds.length > 0).length / allApplicable.length : 0;

    /* red-flag gate: a failed critical checklist item or an open critical
       finding caps the rating — no green dashboard over a critical gap. */
    const criticalItemFails = ev.checklist.filter(
      (c) => c.result === "fail" && templateItem(c.id).severity === "critical"
    );
    const redFlags = DCS_TEMPLATE.RED_FLAGS.filter((rf) =>
      rf.itemIds.some((id) => {
        const it = ev.checklist.find((c) => c.id === id);
        return it && it.result === "fail";
      })
    );
    const openCriticalFindings = ev.findings.filter(
      (f) => f.severity === "critical" && f.status !== "closed"
    );
    const gated = criticalItemFails.length > 0 || openCriticalFindings.length > 0;

    let rating;
    if (overallPct === null)      rating = { id: "unrated",  label: "Not Yet Assessed",  tone: "muted" };
    else if (gated)               rating = { id: "critical", label: "Not Ready — Critical Gap", tone: "critical" };
    else if (overallPct >= 0.85)  rating = { id: "ready",    label: "Operationally Ready",     tone: "good" };
    else if (overallPct >= 0.625) rating = { id: "integrated", label: "Integrated / Repeatable", tone: "good" };
    else if (overallPct >= 0.40)  rating = { id: "demonstrated", label: "Demonstrated",  tone: "warning" };
    else                          rating = { id: "adhoc",    label: "Manual / Ad Hoc",   tone: "serious" };

    return {
      domains, overallPct, coverage, evidenceCompleteness, rating, gated,
      criticalItemFails, openCriticalFindings, redFlags,
      openFindingsBySeverity: Object.fromEntries(
        DCS_TEMPLATE.SEVERITIES.map((s) => [
          s.id, ev.findings.filter((f) => f.severity === s.id && f.status !== "closed").length
        ])
      )
    };
  }

  /* -------------------------------------------------- cross-linking helpers */
  function linkEvidence(ev, evidenceId, kind, targetId) {
    const rec = ev.evidence.find((e) => e.id === evidenceId);
    if (!rec) return;
    if (!rec.links[kind].includes(targetId)) rec.links[kind].push(targetId);
    if (kind === "checklist") {
      const it = ev.checklist.find((c) => c.id === targetId);
      if (it && !it.evidenceIds.includes(evidenceId)) it.evidenceIds.push(evidenceId);
    } else if (kind === "testCards") {
      const tc = ev.testCards.find((t) => t.id === targetId);
      if (tc && !tc.evidenceIds.includes(evidenceId)) tc.evidenceIds.push(evidenceId);
    } else if (kind === "findings") {
      const f = ev.findings.find((x) => x.id === targetId);
      if (f && !f.evidenceIds.includes(evidenceId)) f.evidenceIds.push(evidenceId);
    }
  }

  function unlinkEvidence(ev, evidenceId, kind, targetId) {
    const rec = ev.evidence.find((e) => e.id === evidenceId);
    if (rec) rec.links[kind] = rec.links[kind].filter((x) => x !== targetId);
    if (kind === "checklist") {
      const it = ev.checklist.find((c) => c.id === targetId);
      if (it) it.evidenceIds = it.evidenceIds.filter((x) => x !== evidenceId);
    } else if (kind === "testCards") {
      const tc = ev.testCards.find((t) => t.id === targetId);
      if (tc) tc.evidenceIds = tc.evidenceIds.filter((x) => x !== evidenceId);
    } else if (kind === "findings") {
      const f = ev.findings.find((x) => x.id === targetId);
      if (f) f.evidenceIds = f.evidenceIds.filter((x) => x !== evidenceId);
    }
  }

  function deleteEvidence(ev, evidenceId) {
    ev.checklist.forEach((c) => { c.evidenceIds = c.evidenceIds.filter((x) => x !== evidenceId); });
    ev.testCards.forEach((t) => { t.evidenceIds = t.evidenceIds.filter((x) => x !== evidenceId); });
    ev.findings.forEach((f) => { f.evidenceIds = f.evidenceIds.filter((x) => x !== evidenceId); });
    ev.evidence = ev.evidence.filter((e) => e.id !== evidenceId);
  }

  /* ------------------------------------------------------- import / export */
  function download(filename, text, mime = "application/json") {
    const blob = new Blob([text], { type: mime });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  const slug = (s) => (s || "export").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);

  function exportEventJSON(ev) {
    download(`dcs-event-${slug(ev.name)}.json`,
      JSON.stringify({ exported: nowISO(), app: "DCS Assessment Command Center", version: 1, event: ev }, null, 2));
  }

  function exportWorkspaceJSON() {
    state.lastBackupAt = nowISO();
    download("dcs-workspace-backup.json",
      JSON.stringify({ exported: state.lastBackupAt, app: "DCS Assessment Command Center", version: 1, workspace: state }, null, 2));
    save();
  }

  // Approximate localStorage footprint (browsers allow ~5 MB per origin).
  function storageInfo() {
    let bytes = 0;
    try { bytes = new Blob([localStorage.getItem(LS_KEY) || ""]).size; } catch (e) { /* estimate only */ }
    const quota = 5 * 1024 * 1024;
    return { bytes, quota, pct: bytes / quota };
  }

  function importJSON(obj) {
    if (obj && obj.workspace && Array.isArray(obj.workspace.events)) {
      state = migrate(obj.workspace);
      save();
      return { kind: "workspace" };
    }
    if (obj && obj.event && obj.event.checklist) {
      const ev = obj.event;
      ev.id = uid("EVT"); // avoid collisions
      state.events.push(ev);
      state.activeEventId = ev.id;
      migrate(state);
      save();
      return { kind: "event", name: ev.name };
    }
    throw new Error("Unrecognized file: expected a DCS event or workspace export.");
  }

  function csvEscape(v) {
    const s = String(v ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  const toCSV = (headers, rows) =>
    [headers.map(csvEscape).join(","), ...rows.map((r) => r.map(csvEscape).join(","))].join("\r\n");

  function exportChecklistCSV(ev) {
    const rows = ev.checklist.map((c) => {
      const t = templateItem(c.id);
      const d = domain(t.domainId);
      return [c.id, d.name, t.requirement, t.question, t.evidence.join("; "),
        c.score ?? "", c.result ?? "", c.workflow, c.assignee,
        c.evidenceIds.length, c.findingIds.length,
        t.severity, t.standards.join("; "), c.notes];
    });
    download(`dcs-checklist-${slug(ev.name)}.csv`, toCSV(
      ["ID", "Domain", "Requirement", "Assessment Question", "Expected Evidence",
       "Score (0-4)", "Result", "Workflow", "Assignee", "Evidence Count",
       "Findings", "Severity if Failed", "Standards Mapping", "Notes"], rows), "text/csv");
  }

  function exportFindingsCSV(ev) {
    const rows = ev.findings.map((f) => [
      f.id, f.title, DCS_TEMPLATE.SEVERITIES.find((s) => s.id === f.severity)?.label || f.severity,
      domain(f.domainId)?.name || "", f.impact, f.recommendation, f.owner, f.dueDate, f.status,
      f.checklistIds.join("; "), f.testCardIds.join("; "), f.evidenceIds.length
    ]);
    download(`dcs-findings-${slug(ev.name)}.csv`, toCSV(
      ["ID", "Title", "Severity", "Domain", "Impact", "Recommendation", "Owner",
       "Due Date", "Status", "Checklist Items", "Test Cards", "Evidence Count"], rows), "text/csv");
  }

  function exportEvidenceCSV(ev) {
    const rows = ev.evidence.map((e) => [
      e.id, e.title, e.type, e.sourceSystem, e.capturedBy, e.capturedAt,
      e.classification, e.quality, e.fileName,
      e.links.checklist.join("; "), e.links.testCards.join("; "), e.links.findings.join("; "),
      e.description
    ]);
    download(`dcs-evidence-index-${slug(ev.name)}.csv`, toCSV(
      ["ID", "Title", "Type", "Source System", "Captured By", "Timestamp",
       "Classification", "Quality", "File", "Checklist Links", "Test Card Links",
       "Finding Links", "Description"], rows), "text/csv");
  }

  return {
    uid, nowISO, load, save, subscribe,
    getState, activeEvent, setActiveEvent, addEvent, deleteEvent,
    duplicateEventAsTemplate, templateItem, domain,
    computeScores, linkEvidence, unlinkEvidence, deleteEvidence,
    exportEventJSON, exportWorkspaceJSON, importJSON, storageInfo,
    exportChecklistCSV, exportFindingsCSV, exportEvidenceCSV, download
  };
})();
