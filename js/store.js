/* =========================================================================
 * DCS Assessment Command Center — Store
 * State management, authenticated API persistence, scoring, import/export.
 * The server database is authoritative. Browser memory is only a working copy;
 * classified assessment records are not retained in localStorage.
 * ========================================================================= */

"use strict";

const Store = (() => {
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
      if (ev.execNarrative === undefined) ev.execNarrative = "";
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
    state = { version: 2, activeEventId: null, events: [], settings: { theme: localStorage.getItem("dcs_theme") || "auto" }, lastBackupAt: null };
    return initRemote();
  }

  function persistLocal() {
    try {
      localStorage.setItem("dcs_theme", state.settings.theme || "auto");
    } catch (e) {
      console.error("Save failed:", e);
    }
  }

  function save() {
    persistLocal();
    listeners.forEach((fn) => fn());
    schedulePush();
  }

  /* ---------------------------------------------- authenticated server sync
   * The database contains the assessments visible to the signed-in user.
   * Writes are optimistic: each PUT carries the
   * revision it was based on; a 409 means someone else saved first, so we
   * adopt the server state rather than clobbering it. A light poll picks
   * up teammates' changes between our own saves.
   * ------------------------------------------------------------------- */
  const remote = { enabled: false, revision: 0, timer: null, pushing: false, queued: false, offline: false };

  async function api(path, opts) {
    try { return await Auth.request(path, opts); }
    catch (err) { if (err.status === 409) { err.conflict = true; err.revision = err.payload?.revision; } throw err; }
  }

  async function initRemote() {
    const h = await api("/api/health");
    if (!h || !h.ok) throw new Error("Application health check failed.");
    remote.enabled = true;
    const ws = await api("/api/workspace");
    Auth.setAccess(ws.access);
    if (ws.state && Array.isArray(ws.state.events) && ws.state.events.length) {
      const preferred = state.activeEventId;
      state = migrate(ws.state);
      if (preferred && state.events.some((e) => e.id === preferred)) state.activeEventId = preferred;
      remote.revision = ws.revision;
    } else if (Auth.globalPermissions().includes("assessment.create") && !Auth.user().forcePasswordChange) {
      state = Auth.feature("seedSampleData") ? defaultState() : (() => { const ev = newEvent({ name: "New DCS Assessment" }); return { version: 2, activeEventId: ev.id, events: [ev], settings: { theme: state.settings.theme }, lastBackupAt: null }; })();
      remote.revision = ws.revision;
      await pushNow();
      const seeded = await api("/api/workspace");
      Auth.setAccess(seeded.access);
      state = migrate(seeded.state);
      remote.revision = seeded.revision;
    } else {
      state = migrate(ws.state || state);
      remote.revision = ws.revision;
    }
    persistLocal();
    setInterval(pollRemote, 15000);
  }

  function schedulePush() {
    if (!remote.enabled) return;
    clearTimeout(remote.timer);
    remote.timer = setTimeout(() => { remote.timer = null; pushNow(); }, 500);
  }

  async function pushNow() {
    if (!remote.enabled) return;
    if (remote.pushing) { remote.queued = true; return; }
    remote.pushing = true;
    try {
      const resp = await api("api/workspace", {
        method: "PUT",
        body: JSON.stringify({ revision: remote.revision, state })
      });
      remote.revision = resp.revision;
      if (state.events.some((event) => !Auth.assessmentAccess(event.id).roleId)) {
        const refreshed = await api("/api/workspace");
        Auth.setAccess(refreshed.access);
        state = migrate(refreshed.state);
        remote.revision = refreshed.revision;
      }
      if (remote.offline) {
        remote.offline = false;
        UI.toast("Server connection restored — workspace synced.");
      }
    } catch (err) {
      if (err.conflict) {
        await adoptServerState("Another assessor saved first — loaded the latest shared workspace. Re-apply your last edit if it is missing.", true);
      } else {
        if (!remote.offline) UI.toast(err.message || "The save was rejected. Reloading the authorized server state.", "error");
        remote.offline = true;
        await adoptServerState("Your unsaved local change was discarded; the current authorized version was reloaded.", true).catch(() => {});
      }
    } finally {
      remote.pushing = false;
      if (remote.queued) { remote.queued = false; schedulePush(); }
    }
  }

  async function pollRemote() {
    if (!remote.enabled || remote.pushing || remote.timer) return; // don't race our own pending save
    try {
      const r = await api("api/revision");
      if (r.revision !== remote.revision) {
        // Don't yank the UI out from under an open editor; next poll retries.
        if (document.querySelector("#modal-root.open, #drawer-root .drawer")) return;
        await adoptServerState("Synced updates from another assessor.");
      }
      if (remote.offline) { remote.offline = false; UI.toast("Server connection restored — workspace synced."); }
    } catch (e) { /* transient network issues are fine; push path reports outages */ }
  }

  async function adoptServerState(message, force) {
    const ws = await api("api/workspace");
    if (!ws.state || !Array.isArray(ws.state.events)) return;
    state = migrate(ws.state);
    Auth.setAccess(ws.access);
    remote.revision = ws.revision;
    persistLocal();
    listeners.forEach((fn) => fn());
    UI.toast(message);
    if (typeof App !== "undefined" && App.refresh) App.refresh();
  }

  const isRemote = () => remote.enabled;

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
      JSON.stringify({ exported: nowISO(), app: "DCS Assessment Command Center", version: 2, event: ev }, null, 2));
  }

  function exportWorkspaceJSON() {
    state.lastBackupAt = nowISO();
    download("dcs-workspace-backup.json",
      JSON.stringify({ exported: state.lastBackupAt, app: "DCS Assessment Command Center", version: 2, workspace: state }, null, 2));
    save();
  }

  // Compatibility helper retained for older extensions; assessment content is server-backed.
  function storageInfo() {
    const bytes = new Blob([JSON.stringify(state)]).size;
    const quota = 32 * 1024 * 1024;
    return { bytes, quota, pct: bytes / quota, serverBacked: true };
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

  // RFC-4180-ish CSV parser (quotes, escaped quotes, CRLF). Returns array of
  // objects keyed by the header row (headers normalized to snake_case).
  function parseCSV(text) {
    const rows = [];
    let row = [], cell = "", inQ = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (inQ) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; }
          else inQ = false;
        } else cell += ch;
      } else if (ch === '"') inQ = true;
      else if (ch === ",") { row.push(cell); cell = ""; }
      else if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); cell = "";
        if (row.some((c) => c !== "")) rows.push(row);
        row = [];
      } else cell += ch;
    }
    row.push(cell);
    if (row.some((c) => c !== "")) rows.push(row);
    if (rows.length < 2) return [];
    const headers = rows[0].map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""));
    return rows.slice(1).map((r) =>
      Object.fromEntries(headers.map((h, i) => [h, (r[i] || "").trim()])));
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
    uid, nowISO, load, save, subscribe, isRemote,
    getState, activeEvent, setActiveEvent, addEvent, deleteEvent,
    duplicateEventAsTemplate, templateItem, domain,
    computeScores, linkEvidence, unlinkEvidence, deleteEvidence,
    exportEventJSON, exportWorkspaceJSON, importJSON, storageInfo, parseCSV,
    exportChecklistCSV, exportFindingsCSV, exportEvidenceCSV, download
  };
})();
