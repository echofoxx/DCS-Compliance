/* =========================================================================
 * DCS Assessment Command Center — DCS Compliance Checklist view
 * 55-item white-paper checklist with filtering, drill-in scoring drawer,
 * evidence linking, finding generation, and bulk assignment.
 * ========================================================================= */

"use strict";

const ViewChecklist = (() => {
  const { el, field, input, textarea, select } = UI;

  const filters = { domain: "", result: "", workflow: "", severity: "", evidence: "", assignee: "", thread: "", scope: "", q: "" };

  function render(container, params = {}) {
    // apply deep-link params from dashboard tiles
    if (params.domain !== undefined) { resetFilters(); filters.domain = params.domain; }
    if (params.evidence !== undefined) { resetFilters(); filters.evidence = params.evidence; }

    const ev = Store.activeEvent();
    container.innerHTML = "";
    const view = el("div", { class: "view" });

    const scores = Store.computeScores(ev);
    const modeMeta = DCS_TEMPLATE.FRAMEWORK_MODES.find((m) => m.id === (ev.frameworkMode || "combined")) || {};

    view.appendChild(el("div", { class: "view-head" },
      el("div", {},
        el("h1", {}, "DCS Compliance Checklist"),
        el("p", { class: "view-sub" }, `${scores.inScopeCount} in-scope items · Framework mode: ${modeMeta.label}. Score with the 0–4 maturity rubric; every score should be backed by linked evidence.`)),
      el("div", { class: "view-actions" },
        el("button", { class: "btn", onclick: () => bulkAssign(ev) }, "Bulk Assign"),
        el("button", { class: "btn", onclick: () => Store.exportChecklistCSV(ev) }, "Export CSV"))));

    view.appendChild(rubricStrip());
    view.appendChild(filterBar(ev));

    const items = filtered(ev);
    const byDomain = new Map();
    items.forEach((c) => {
      const d = Store.templateItem(c.id).domainId;
      if (!byDomain.has(d)) byDomain.set(d, []);
      byDomain.get(d).push(c);
    });

    if (!items.length) {
      view.appendChild(UI.empty("No checklist items match the current filters", "Clear filters to see all 55 items."));
    }

    DCS_TEMPLATE.DOMAINS.forEach((d) => {
      const list = byDomain.get(d.id);
      if (!list) return;
      const scored = list.filter((c) => c.score !== null && c.result !== "na");
      const avg = scored.length ? (scored.reduce((s, c) => s + c.score, 0) / scored.length) : null;
      view.appendChild(el("div", { class: "card domain-card" },
        el("div", { class: "domain-head" },
          el("div", {},
            el("h3", { class: "card-title" }, `${d.code}  ${d.name}`),
            el("p", { class: "card-hint" }, d.focus)),
          el("div", { class: "domain-stats" },
            UI.badge(`weight ${Store.activeEvent().domainWeights[d.id] ?? d.weight}%`, "muted"),
            UI.badge(avg === null ? "not scored" : `avg ${avg.toFixed(1)} / 4`, avg === null ? "muted" : avg >= 3 ? "good" : avg >= 2 ? "warning" : "serious"))),
        el("table", { class: "data-table checklist-table" },
          el("thead", {}, el("tr", {},
            ["ID", "Compliance Check", "Score", "Result", "Workflow", "Evidence", "Owner", "Severity if Failed"].map((h) => el("th", {}, h)))),
          el("tbody", {}, list.map((c) => row(ev, c))))));
    });

    container.appendChild(view);
    if (params.open) {
      const item = ev.checklist.find((c) => c.id === params.open);
      if (item) openItem(ev, item);
    }
  }

  const resetFilters = () => Object.keys(filters).forEach((k) => { filters[k] = ""; });

  function rubricStrip() {
    return el("div", { class: "rubric-strip" }, DCS_TEMPLATE.SCORE_RUBRIC.map((r) =>
      el("span", { class: "rubric-chip", title: r.meaning },
        UI.scorePill(r.score), ` ${r.label}`)));
  }

  function filterBar(ev) {
    const mk = (key, options, placeholder) => {
      const s = select([{ value: "", label: placeholder }, ...options], filters[key]);
      s.addEventListener("change", () => { filters[key] = s.value; App.go("checklist"); });
      return s;
    };
    const q = input({ value: filters.q, placeholder: "Search requirement text…", class: "input search-input" });
    q.addEventListener("input", debounce(() => { filters.q = q.value; App.go("checklist"); }, 250));

    const assignees = [...new Set(ev.checklist.map((c) => c.assignee).filter(Boolean))];

    return el("div", { class: "filter-bar" },
      q,
      mk("domain", DCS_TEMPLATE.DOMAINS.map((d) => ({ value: d.id, label: d.name })), "All domains"),
      mk("result", DCS_TEMPLATE.RESULT_STATES.map((r) => ({ value: r.id, label: r.label })), "Any result"),
      mk("workflow", DCS_TEMPLATE.WORKFLOW_STATES.map((w) => ({ value: w.id, label: w.label })), "Any workflow"),
      mk("severity", DCS_TEMPLATE.SEVERITIES.filter((s) => ["critical", "major", "moderate"].includes(s.id))
        .map((s) => ({ value: s.id, label: `Severity: ${s.label}` })), "Any severity"),
      mk("evidence", [{ value: "missing", label: "Missing evidence" }, { value: "has", label: "Has evidence" }], "Evidence: any"),
      mk("scope", [{ value: "in", label: "In scope only" }, { value: "out", label: "Out of scope only" }, { value: "all", label: "Show all (incl. out of scope)" }], "Scope: in only"),
      assignees.length ? mk("assignee", assignees.map((a) => ({ value: a, label: a })), "Any owner") : null,
      ev.missionThreads.length ? mk("thread", ev.missionThreads.map((m) => ({ value: m.id, label: m.name })), "Any mission thread") : null,
      el("button", { class: "btn btn-ghost", onclick: () => { resetFilters(); App.go("checklist"); } }, "Clear"));
  }

  let debounceTimer;
  function debounce(fn, ms) { return (...a) => { clearTimeout(debounceTimer); debounceTimer = setTimeout(() => fn(...a), ms); }; }

  function filtered(ev) {
    // Default view hides out-of-scope items so assessors work only on what
    // matters. "Show all" surfaces them for review; "Out of scope only" is
    // the audit view.
    const scopeFilter = filters.scope || "in";
    return ev.checklist.filter((c) => {
      const t = Store.templateItem(c.id);
      const inScope = Store.isInScope(ev, c);
      if (scopeFilter === "in" && !inScope) return false;
      if (scopeFilter === "out" && inScope) return false;
      if (filters.domain && t.domainId !== filters.domain) return false;
      if (filters.result && c.result !== filters.result) return false;
      if (filters.workflow && c.workflow !== filters.workflow) return false;
      if (filters.severity && t.severity !== filters.severity) return false;
      if (filters.evidence === "missing" && c.evidenceIds.length) return false;
      if (filters.evidence === "has" && !c.evidenceIds.length) return false;
      if (filters.assignee && c.assignee !== filters.assignee) return false;
      if (filters.thread && !c.missionThreadIds.includes(filters.thread)) return false;
      if (filters.q) {
        const q = filters.q.toLowerCase();
        if (!(`${c.id} ${t.requirement} ${t.question}`.toLowerCase().includes(q))) return false;
      }
      return true;
    });
  }

  function row(ev, c) {
    const t = Store.templateItem(c.id);
    const inScope = Store.isInScope(ev, c);
    return el("tr", { class: `clickable${inScope ? "" : " row-out-of-scope"}`, onclick: () => openItem(ev, c) },
      el("td", { class: "cell-id" }, c.id,
        !inScope ? el("div", { class: "cell-sub" }, UI.badge("out of scope", "muted")) : null),
      el("td", {}, t.requirement,
        c.missionThreadIds.length ? el("div", { class: "cell-sub" },
          "Threads: " + c.missionThreadIds.map((id) => (ev.missionThreads.find((m) => m.id === id) || {}).name).filter(Boolean).join(", ")) : null),
      el("td", {}, UI.scorePill(c.score)),
      el("td", {}, UI.resultBadge(c.result)),
      el("td", {}, UI.workflowBadge(c.workflow)),
      el("td", {}, c.evidenceIds.length
        ? UI.badge(`${c.evidenceIds.length} linked`, "good")
        : UI.badge("none", c.score !== null && inScope ? "serious" : "muted")),
      el("td", {}, c.assignee || "—"),
      el("td", {}, UI.severityBadge(t.severity)));
  }

  /* --------------------------------------------------- drill-in drawer */
  function openItem(ev, c) {
    const t = Store.templateItem(c.id);
    const d = Store.domain(t.domainId);

    const scoreS = select(
      [{ value: "", label: "Unscored" }, ...DCS_TEMPLATE.SCORE_RUBRIC.map((r) => ({ value: String(r.score), label: `${r.score} — ${r.label}` }))],
      c.score === null ? "" : String(c.score));
    const resultS = select(
      [{ value: "", label: "—" }, ...DCS_TEMPLATE.RESULT_STATES.map((r) => ({ value: r.id, label: r.label }))],
      c.result || "");
    const wfS = select(DCS_TEMPLATE.WORKFLOW_STATES.map((w) => ({ value: w.id, label: w.label })), c.workflow);
    const scopeS = select(DCS_TEMPLATE.SCOPE_STATES.map((s) => ({ value: s.id, label: s.label })), c.scope || "in_scope");
    const scopeReasonI = input({ value: c.scopeReason || "", placeholder: "Why is this item out of scope or N/A? (recorded in the report)" });
    const ownI = input({ value: c.assignee, placeholder: "Assessor responsible" });
    const notesI = textarea({ value: c.notes, rows: 4, placeholder: "Observations, caveats, and context for this score…" });
    const frameworkAllows = Store.itemInFrameworkMode(c.id, ev.frameworkMode);
    const threadPick = UI.checkList(ev.missionThreads.map((m) => ({ value: m.id, label: m.name })), c.missionThreadIds, "cl-threads");
    const evidencePick = UI.checkList(ev.evidence.map((e) => ({ value: e.id, label: `${e.title} (${e.type})` })), c.evidenceIds, "cl-evidence");

    const linkedTests = ev.testCards.filter((tc) => tc.checklistIds.includes(c.id));
    const linkedFindings = ev.findings.filter((f) => f.checklistIds.includes(c.id));

    const saveBtn = el("button", { class: "btn btn-primary", onclick: () => {
        if (scopeS.value !== "in_scope" && !scopeReasonI.value.trim()) {
          UI.toast("A scope reason is required when marking an item out of scope or N/A.", "error");
          return;
        }
        c.score = scoreS.value === "" ? null : parseInt(scoreS.value, 10);
        c.result = resultS.value || null;
        c.workflow = wfS.value;
        c.scope = scopeS.value;
        c.scopeReason = scopeReasonI.value.trim();
        c.assignee = ownI.value.trim();
        c.notes = notesI.value.trim();
        c.missionThreadIds = UI.checkedValues(threadPick, "cl-threads");
        const newEvidence = UI.checkedValues(evidencePick, "cl-evidence");
        c.evidenceIds.filter((id) => !newEvidence.includes(id)).forEach((id) => Store.unlinkEvidence(ev, id, "checklist", c.id));
        newEvidence.forEach((id) => Store.linkEvidence(ev, id, "checklist", c.id));
        c.updatedAt = Store.nowISO();
        Store.save();
        UI.toast(`${c.id} saved.`);
        UI.closeDrawer();
        App.go("checklist");
      } }, "Save Assessment");

    const findingBtn = el("button", { class: "btn btn-danger-ghost", onclick: () => {
        UI.closeDrawer();
        ViewFindings.editFinding(ev, null, {
          title: `${c.id}: ${t.requirement.replace(/\.$/, "")} — gap identified`,
          severity: t.severity, domainId: t.domainId,
          checklistIds: [c.id], evidenceIds: c.evidenceIds.slice(),
          missionThreadId: c.missionThreadIds[0] || ""
        }, () => App.go("checklist", { open: c.id }));
      } }, "Generate Finding");

    UI.drawer(c.id, d.name, el("div", {},
      UI.attribution(c),
      el("div", { class: "drawer-req" }, t.requirement),
      el("dl", { class: "detail-list" },
        el("dt", {}, "Assessment Question"), el("dd", {}, t.question),
        el("dt", {}, "Expected Evidence"), el("dd", {}, el("ul", { class: "plain-list" }, t.evidence.map((e) => el("li", {}, e)))),
        el("dt", {}, "Severity if Failed"), el("dd", {}, UI.severityBadge(t.severity)),
        el("dt", {}, "Standards Mapping"), el("dd", {}, el("div", { class: "chip-row" }, t.standards.map((s) => UI.badge(s, "info")))),
        el("dt", {}, "Last Updated"), el("dd", {}, UI.fmtDate(c.updatedAt))),

      el("h4", { class: "drawer-h" }, "Scope"),
      !frameworkAllows ? el("div", { class: "gate-note" },
        "This item is out of scope by framework mode. Change the assessment's Framework Mode in Event Workspace → Event Profile to include it.") : null,
      el("div", { class: "form-grid" },
        field("Scope", scopeS,
          "In-scope items count toward readiness. Out-of-scope items are excluded from scoring and the critical gate."),
        field("Reason (required if not In scope)", scopeReasonI)),

      el("h4", { class: "drawer-h" }, "Assessment"),
      el("div", { class: "form-grid" },
        field("Maturity Score (0–4)", scoreS),
        field("Result", resultS),
        field("Workflow Status", wfS),
        field("Owner / Assessor", ownI)),
      field("Assessor Notes", notesI),

      el("h4", { class: "drawer-h" }, "Mission Threads"),
      ev.missionThreads.length ? threadPick : el("p", { class: "empty-mini" }, "Define mission threads in the Event Workspace first."),

      el("h4", { class: "drawer-h" }, `Linked Evidence (${c.evidenceIds.length})`),
      ev.evidence.length ? evidencePick : el("p", { class: "empty-mini" }, "No evidence in the locker yet — add records in Evidence Locker."),
      el("button", { class: "btn btn-ghost", onclick: () => {
          UI.closeDrawer();
          ViewEvidence.editEvidence(ev, null, { links: { checklist: [c.id], testCards: [], findings: [] } },
            () => App.go("checklist", { open: c.id }));
        } }, "+ New Evidence for This Item"),

      linkedTests.length ? el("div", {},
        el("h4", { class: "drawer-h" }, `Test Cards Proving This Item (${linkedTests.length})`),
        el("ul", { class: "mini-list" }, linkedTests.map((tc) =>
          el("li", { class: "mini-row clickable", onclick: () => { UI.closeDrawer(); App.go("testcards", { open: tc.id }); } },
            UI.resultBadge(tc.result), el("span", { class: "mini-title" }, tc.title))))) : null,

      linkedFindings.length ? el("div", {},
        el("h4", { class: "drawer-h" }, `Findings (${linkedFindings.length})`),
        el("ul", { class: "mini-list" }, linkedFindings.map((f) =>
          el("li", { class: "mini-row clickable", onclick: () => { UI.closeDrawer(); App.go("findings", { open: f.id }); } },
            UI.severityBadge(f.severity), el("span", { class: "mini-title" }, f.title))))) : null,

      el("div", { class: "drawer-actions" }, saveBtn, findingBtn)));
  }

  /* -------------------------------------------------------- bulk assign */
  function bulkAssign(ev) {
    const domS = select([{ value: "", label: "All domains" },
      ...DCS_TEMPLATE.DOMAINS.map((d) => ({ value: d.id, label: d.name }))], "");
    const ownI = input({ placeholder: "Assessor name" });
    const onlyUnassigned = el("input", { type: "checkbox", checked: true });
    UI.modal("Bulk Assign Checklist Items", el("div", { class: "form-grid" },
      field("Domain", domS),
      field("Assign To", ownI),
      el("label", { class: "check-row" }, onlyUnassigned, el("span", {}, "Only items without an owner"))), [
      { label: "Cancel", onclick: () => {} },
      { label: "Assign", primary: true, onclick: () => {
          const owner = ownI.value.trim();
          if (!owner) { UI.toast("Enter an assessor name.", "error"); return false; }
          let n = 0;
          ev.checklist.forEach((c) => {
            const t = Store.templateItem(c.id);
            if (domS.value && t.domainId !== domS.value) return;
            if (onlyUnassigned.checked && c.assignee) return;
            c.assignee = owner; n++;
          });
          Store.save();
          UI.toast(`Assigned ${n} item(s) to ${owner}.`);
          App.go("checklist");
        } }]);
  }

  return { render, openItem };
})();
