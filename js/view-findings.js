/* =========================================================================
 * DCS Assessment Command Center — Findings & Remediation view
 * Findings with severity, owner, due date, remediation status, and the
 * full traceability chain back to threads, checks, tests, and evidence.
 * ========================================================================= */

"use strict";

const ViewFindings = (() => {
  const { el, field, input, textarea, select } = UI;

  const STATUSES = [
    { id: "open",           label: "Open" },
    { id: "in_remediation", label: "In Remediation" },
    { id: "accepted_risk",  label: "Risk Accepted" },
    { id: "closed",         label: "Closed" }
  ];
  const STATUS_TONE = { open: "critical", in_remediation: "warning", accepted_risk: "serious", closed: "good" };

  const filters = { severity: "", status: "", q: "" };

  function render(container, params = {}) {
    if (params.severity !== undefined) { Object.keys(filters).forEach((k) => filters[k] = ""); filters.severity = params.severity; }
    const ev = Store.activeEvent();
    container.innerHTML = "";
    const view = el("div", { class: "view" });

    view.appendChild(el("div", { class: "view-head" },
      el("div", {},
        el("h1", {}, "Findings & Remediation"),
        el("p", { class: "view-sub" }, "Gaps, risks, strengths, and recommendations. Every finding traces back through checklist items, test cards, and evidence — the chain that makes the final report defensible.")),
      el("div", { class: "view-actions" },
        el("button", { class: "btn", onclick: () => Store.exportFindingsCSV(ev) }, "Export CSV"),
        el("button", { class: "btn btn-primary", onclick: () => editFinding(ev, null) }, "+ New Finding"))));

    view.appendChild(el("div", { class: "tile-grid tiles-4" },
      ...DCS_TEMPLATE.SEVERITIES.filter((s) => s.id !== "observation").map((s) => {
        const open = ev.findings.filter((f) => f.severity === s.id && (s.id === "strength" || f.status !== "closed")).length;
        return Charts.statTile(s.label, open, {
          tone: s.id === "critical" && open ? "critical" : s.id === "strength" && open ? "good" : null,
          sub: s.id === "strength" ? "patterns to preserve" : "open",
          onclick: () => { filters.severity = s.id; filters.status = ""; App.go("findings"); }
        });
      })));

    /* filters */
    const mkSel = (key, options, placeholder) => {
      const s = select([{ value: "", label: placeholder }, ...options], filters[key]);
      s.addEventListener("change", () => { filters[key] = s.value; App.go("findings"); });
      return s;
    };
    const q = input({ value: filters.q, placeholder: "Search findings…", class: "input search-input" });
    let timer;
    q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => { filters.q = q.value; App.go("findings"); }, 250); });
    view.appendChild(el("div", { class: "filter-bar" },
      q,
      mkSel("severity", DCS_TEMPLATE.SEVERITIES.map((s) => ({ value: s.id, label: s.label })), "Any severity"),
      mkSel("status", STATUSES.map((s) => ({ value: s.id, label: s.label })), "Any status"),
      el("button", { class: "btn btn-ghost", onclick: () => { Object.keys(filters).forEach((k) => filters[k] = ""); App.go("findings"); } }, "Clear")));

    const sevRank = { critical: 0, major: 1, moderate: 2, observation: 3, strength: 4 };
    const list = ev.findings
      .filter((f) => {
        if (filters.severity && f.severity !== filters.severity) return false;
        if (filters.status && f.status !== filters.status) return false;
        if (filters.q && !(`${f.title} ${f.impact} ${f.recommendation} ${f.owner}`.toLowerCase().includes(filters.q.toLowerCase()))) return false;
        return true;
      })
      .sort((a, b) => (sevRank[a.severity] ?? 9) - (sevRank[b.severity] ?? 9));

    if (!list.length) {
      view.appendChild(UI.empty("No findings match", "Generate findings from failed checklist items or test cards, or add one manually."));
    } else {
      view.appendChild(el("div", { class: "card table-card" },
        el("table", { class: "data-table" },
          el("thead", {}, el("tr", {},
            ["Severity", "Finding", "Domain", "Owner", "Due", "Status", "Trace", ""].map((h) => el("th", {}, h)))),
          el("tbody", {}, list.map((f) =>
            el("tr", { class: "clickable", onclick: () => openFinding(ev, f) },
              el("td", {}, UI.severityBadge(f.severity)),
              el("td", {}, el("strong", {}, f.title),
                f.impact ? el("div", { class: "cell-sub" }, f.impact) : null),
              el("td", {}, (Store.domain(f.domainId) || {}).short || "—"),
              el("td", {}, f.owner || "unassigned"),
              el("td", {}, f.dueDate || "—"),
              el("td", {}, UI.badge(STATUSES.find((s) => s.id === f.status)?.label || f.status, STATUS_TONE[f.status] || "muted")),
              el("td", {}, UI.badge(`${f.checklistIds.length} chk · ${f.testCardIds.length} test · ${f.evidenceIds.length} evd`,
                (f.checklistIds.length + f.testCardIds.length + f.evidenceIds.length) ? "info" : "warning")),
              el("td", { onclick: (e) => e.stopPropagation() },
                el("button", { class: "icon-btn", title: "Edit", onclick: () => editFinding(ev, f) }, "✎"),
                el("button", { class: "icon-btn danger", title: "Delete", onclick: () =>
                  UI.confirm("Delete finding", `Delete “${f.title}”?`, () => {
                    ev.findings = ev.findings.filter((x) => x.id !== f.id);
                    ev.checklist.forEach((c) => { c.findingIds = c.findingIds.filter((x) => x !== f.id); });
                    ev.evidence.forEach((e2) => { e2.links.findings = e2.links.findings.filter((x) => x !== f.id); });
                    Store.save(); App.go("findings");
                  }) }, "🗑"))))))));
    }

    container.appendChild(view);
    if (params.open) {
      const f = ev.findings.find((x) => x.id === params.open);
      if (f) openFinding(ev, f);
    }
  }

  /* --------------------------------------------------------- traceability */
  function traceChain(ev, f) {
    const mt = ev.missionThreads.find((m) => m.id === f.missionThreadId);
    const steps = [];
    if (mt) steps.push({ kind: "Mission Thread", label: mt.name, go: () => App.go("event", { tab: "threads", open: mt.id }) });
    f.checklistIds.forEach((id) => {
      const t = Store.templateItem(id);
      if (t) steps.push({ kind: "Checklist Item", label: `${id} — ${t.requirement}`, go: () => App.go("checklist", { open: id }) });
    });
    f.testCardIds.forEach((id) => {
      const t = ev.testCards.find((x) => x.id === id);
      if (t) steps.push({ kind: "Test Card", label: t.title, go: () => App.go("testcards", { open: id }) });
    });
    f.evidenceIds.forEach((id) => {
      const e = ev.evidence.find((x) => x.id === id);
      if (e) steps.push({ kind: "Evidence", label: e.title, go: () => App.go("evidence", { open: id }) });
    });
    if (!steps.length) return el("p", { class: "empty-mini" }, "No traceability links yet — link this finding to the checks, tests, and evidence that support it.");
    return el("ol", { class: "trace-chain" }, steps.map((s) =>
      el("li", { class: "trace-step clickable", onclick: () => { UI.closeDrawer(); s.go(); } },
        el("span", { class: "trace-kind" }, s.kind),
        el("span", { class: "trace-label" }, s.label))));
  }

  function openFinding(ev, f) {
    UI.drawer(f.title, `Finding · ${(Store.domain(f.domainId) || {}).name || ""}`, el("div", {},
      el("div", { class: "chip-row" },
        UI.severityBadge(f.severity),
        UI.badge(STATUSES.find((s) => s.id === f.status)?.label || f.status, STATUS_TONE[f.status] || "muted")),
      el("dl", { class: "detail-list" },
        el("dt", {}, "Impact"), el("dd", {}, f.impact || "—"),
        el("dt", {}, "Recommendation"), el("dd", {}, f.recommendation || "—"),
        el("dt", {}, "Owner"), el("dd", {}, f.owner || "unassigned"),
        el("dt", {}, "Due Date"), el("dd", {}, f.dueDate || "—"),
        el("dt", {}, "Created"), el("dd", {}, UI.fmtDate(f.createdAt)),
        el("dt", {}, "Notes"), el("dd", {}, f.notes || "—")),
      el("h4", { class: "drawer-h" }, "Traceability Chain"),
      el("p", { class: "card-hint" }, "Mission Thread → Checklist Item → Test Card → Evidence — the defensible path from operational need to this finding."),
      traceChain(ev, f),
      el("div", { class: "drawer-actions" },
        el("button", { class: "btn btn-primary", onclick: () => { UI.closeDrawer(); editFinding(ev, f); } }, "Edit"))));
  }

  /* ------------------------------------------------------------ edit form */
  // presets: pre-filled fields when generated from a checklist item / test card
  function editFinding(ev, f, presets = {}, onDone = null) {
    const isNew = !f;
    const data = f || Object.assign({
      id: Store.uid("FND"), title: "", severity: "major", domainId: "D06",
      impact: "", recommendation: "", owner: "", dueDate: "", status: "open",
      evidenceIds: [], checklistIds: [], testCardIds: [], missionThreadId: "",
      notes: "", createdAt: Store.nowISO()
    }, presets);

    const titleI = input({ value: data.title });
    const sevS = select(DCS_TEMPLATE.SEVERITIES.map((s) => ({ value: s.id, label: s.label })), data.severity);
    const domS = select(DCS_TEMPLATE.DOMAINS.map((d) => ({ value: d.id, label: d.name })), data.domainId);
    const impI = textarea({ value: data.impact, rows: 3, placeholder: "Mission and security implication if unresolved…" });
    const recI = textarea({ value: data.recommendation, rows: 3, placeholder: "Prioritized fix or scale recommendation…" });
    const ownI = input({ value: data.owner, placeholder: "e.g., System integrator" });
    const dueI = input({ value: data.dueDate, type: "date" });
    const stS = select(STATUSES.map((s) => ({ value: s.id, label: s.label })), data.status);
    const mtS = select([{ value: "", label: "—" }, ...ev.missionThreads.map((m) => ({ value: m.id, label: m.name }))], data.missionThreadId);
    const notesI = textarea({ value: data.notes, rows: 2 });
    const clPick = UI.checkList(DCS_TEMPLATE.CHECKLIST.map((c) => ({ value: c.id, label: `${c.id} — ${c.requirement}` })), data.checklistIds, "f-cl");
    const tcPick = UI.checkList(ev.testCards.map((t) => ({ value: t.id, label: t.title })), data.testCardIds, "f-tc");
    const evPick = UI.checkList(ev.evidence.map((e) => ({ value: e.id, label: `${e.title} (${e.type})` })), data.evidenceIds, "f-ev");

    // optional local-AI draft of impact/recommendation from the linked context
    const aiBtn = Assistant.draftButton("Draft impact & recommendation", async () => {
      const checklistIds = UI.checkedValues(clPick, "f-cl");
      const testIds = UI.checkedValues(tcPick, "f-tc");
      const evidenceIds = UI.checkedValues(evPick, "f-ev");
      const result = await Assistant.draftFinding({
        title: titleI.value.trim(),
        severity: (DCS_TEMPLATE.SEVERITIES.find((s) => s.id === sevS.value) || {}).label || sevS.value,
        domain: (Store.domain(domS.value) || {}).name || "",
        requirements: checklistIds.map((id) => (Store.templateItem(id) || {}).requirement).filter(Boolean),
        tests: testIds.map((id) => {
          const t = ev.testCards.find((x) => x.id === id);
          return t ? `${t.title}: expected ${t.expectedOutcome || "?"}, observed ${t.actualOutcome || "not run"}` : null;
        }).filter(Boolean),
        evidence: evidenceIds.map((id) => {
          const e = ev.evidence.find((x) => x.id === id);
          return e ? `${e.title} (${e.type}, ${e.quality})` : null;
        }).filter(Boolean),
        notes: notesI.value.trim()
      });
      if (result.impact) impI.value = result.impact;
      if (result.recommendation) recI.value = result.recommendation;
    });

    UI.modal(isNew ? "New Finding" : "Edit Finding", el("div", {},
      field("Finding Title", titleI),
      el("div", { class: "form-grid" },
        field("Severity", sevS, (DCS_TEMPLATE.SEVERITIES.find((s) => s.id === data.severity) || {}).definition),
        field("DCS Domain", domS),
        field("Owner", ownI), field("Due Date", dueI),
        field("Status", stS), field("Mission Thread", mtS)),
      field("Impact", impI),
      field("Recommendation", recI),
      el("div", { class: "ai-row" }, aiBtn,
        el("span", { class: "field-hint" }, "Drafts from the linked items, tests, evidence, and notes — review and edit before saving.")),
      field("Notes", notesI),
      el("details", { class: "picker-details", open: isNew && !!presets.checklistIds },
        el("summary", {}, "Linked checklist items"), clPick),
      ev.testCards.length ? el("details", { class: "picker-details" },
        el("summary", {}, "Linked test cards"), tcPick) : null,
      ev.evidence.length ? el("details", { class: "picker-details" },
        el("summary", {}, "Linked evidence"), evPick) : null), [
      { label: "Cancel", onclick: () => { if (onDone) onDone(); } },
      { label: isNew ? "Create Finding" : "Save", primary: true, onclick: () => {
          if (!titleI.value.trim()) { UI.toast("Title is required.", "error"); return false; }
          const oldChecklist = data.checklistIds.slice();
          const oldEvidence = data.evidenceIds.slice();
          Object.assign(data, {
            title: titleI.value.trim(), severity: sevS.value, domainId: domS.value,
            impact: impI.value.trim(), recommendation: recI.value.trim(),
            owner: ownI.value.trim(), dueDate: dueI.value, status: stS.value,
            missionThreadId: mtS.value, notes: notesI.value.trim(),
            checklistIds: UI.checkedValues(clPick, "f-cl"),
            testCardIds: UI.checkedValues(tcPick, "f-tc"),
            evidenceIds: UI.checkedValues(evPick, "f-ev")
          });
          if (isNew) ev.findings.push(data);
          // maintain reverse links on checklist items
          oldChecklist.filter((id) => !data.checklistIds.includes(id)).forEach((id) => {
            const c = ev.checklist.find((x) => x.id === id);
            if (c) c.findingIds = c.findingIds.filter((x) => x !== data.id);
          });
          data.checklistIds.forEach((id) => {
            const c = ev.checklist.find((x) => x.id === id);
            if (c && !c.findingIds.includes(data.id)) c.findingIds.push(data.id);
          });
          // maintain reverse links on evidence
          oldEvidence.filter((id) => !data.evidenceIds.includes(id)).forEach((id) => Store.unlinkEvidence(ev, id, "findings", data.id));
          data.evidenceIds.forEach((id) => Store.linkEvidence(ev, id, "findings", data.id));
          Store.save();
          UI.toast(isNew ? "Finding created." : "Finding saved.");
          if (onDone) onDone(); else App.go("findings");
        } }]);
  }

  return { render, editFinding, STATUSES };
})();
