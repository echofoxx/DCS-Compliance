/* =========================================================================
 * DCS Assessment Command Center — Test Card Manager view
 * Scenario-based tests with expected vs. actual DCS outcomes, latency
 * capture, evidence links, and one-click conversion of failures to findings.
 * ========================================================================= */

"use strict";

const ViewTestCards = (() => {
  const { el, field, input, textarea, select } = UI;

  const filters = { result: "", thread: "", q: "" };

  function render(container, params = {}) {
    const ev = Store.activeEvent();
    container.innerHTML = "";
    const view = el("div", { class: "view" });

    const run = ev.testCards.filter((t) => t.result);
    const passed = run.filter((t) => t.result === "pass").length;
    const failed = run.filter((t) => t.result === "fail").length;
    const mismatches = run.filter((t) => t.actualOutcome && t.expectedOutcome && t.actualOutcome !== t.expectedOutcome).length;

    view.appendChild(el("div", { class: "view-head" },
      el("div", {},
        el("h1", {}, "Test Cards"),
        el("p", { class: "view-sub" }, "Every card records an expected DCS decision (allow / deny / redact / mask / quarantine…) and the actual observed outcome. Expected ≠ actual is the core compliance signal.")),
      el("div", { class: "view-actions" },
        el("button", { class: "btn", onclick: () => addFromLibrary(ev) }, "+ From Scenario Library"),
        el("button", { class: "btn btn-primary", onclick: () => editCard(ev, null) }, "+ New Test Card"))));

    view.appendChild(el("div", { class: "tile-grid tiles-4" },
      Charts.statTile("Cards", ev.testCards.length, { sub: "total defined" }),
      Charts.statTile("Executed", run.length, { sub: `${passed} passed` }),
      Charts.statTile("Failed", failed, { tone: failed ? "critical" : "good", sub: "expected ≠ demonstrated" }),
      Charts.statTile("Outcome Mismatches", mismatches, { tone: mismatches ? "warning" : "good", sub: "actual differs from expected" })));

    /* filters */
    const mkSel = (key, options, placeholder) => {
      const s = select([{ value: "", label: placeholder }, ...options], filters[key]);
      s.addEventListener("change", () => { filters[key] = s.value; App.go("testcards"); });
      return s;
    };
    const q = input({ value: filters.q, placeholder: "Search scenarios…", class: "input search-input" });
    let timer;
    q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => { filters.q = q.value; App.go("testcards"); }, 250); });
    view.appendChild(el("div", { class: "filter-bar" },
      q,
      mkSel("result", DCS_TEMPLATE.RESULT_STATES.map((r) => ({ value: r.id, label: r.label })), "Any result"),
      ev.missionThreads.length ? mkSel("thread", ev.missionThreads.map((m) => ({ value: m.id, label: m.name })), "Any mission thread") : null,
      el("button", { class: "btn btn-ghost", onclick: () => { filters.result = ""; filters.thread = ""; filters.q = ""; App.go("testcards"); } }, "Clear")));

    const cards = ev.testCards.filter((t) => {
      if (filters.result && t.result !== filters.result) return false;
      if (filters.thread && t.missionThreadId !== filters.thread) return false;
      if (filters.q && !(`${t.title} ${t.scenario} ${t.dcsUseCase}`.toLowerCase().includes(filters.q.toLowerCase()))) return false;
      return true;
    });

    if (!cards.length) {
      view.appendChild(UI.empty("No test cards", "Create cards manually or pull proven scenario patterns from the library."));
    } else {
      view.appendChild(el("div", { class: "card table-card" },
        el("table", { class: "data-table" },
          el("thead", {}, el("tr", {},
            ["Test", "Mission Thread", "Expected", "Actual", "Score", "Result", "Evidence", "Day", ""].map((h) => el("th", {}, h)))),
          el("tbody", {}, cards.map((t) => {
            const mismatch = t.actualOutcome && t.expectedOutcome && t.actualOutcome !== t.expectedOutcome;
            return el("tr", { class: "clickable", onclick: () => openCard(ev, t) },
              el("td", {}, el("strong", {}, t.title), el("div", { class: "cell-sub" }, t.dcsUseCase || "")),
              el("td", {}, (ev.missionThreads.find((m) => m.id === t.missionThreadId) || {}).name || "—"),
              el("td", {}, UI.badge(t.expectedOutcome || "—", "info")),
              el("td", {}, t.actualOutcome
                ? UI.badge(t.actualOutcome, mismatch ? "critical" : "good")
                : UI.badge("not run", "muted")),
              el("td", {}, UI.scorePill(t.score)),
              el("td", {}, UI.resultBadge(t.result)),
              el("td", {}, t.evidenceIds.length ? UI.badge(`${t.evidenceIds.length}`, "good") : UI.badge("0", t.result ? "serious" : "muted")),
              el("td", {}, t.day || "—"),
              el("td", { onclick: (e) => e.stopPropagation() },
                el("button", { class: "icon-btn", title: "Edit", onclick: () => editCard(ev, t) }, "✎"),
                el("button", { class: "icon-btn danger", title: "Delete", onclick: () =>
                  UI.confirm("Delete test card", `Delete “${t.title}”?`, () => {
                    ev.testCards = ev.testCards.filter((x) => x.id !== t.id);
                    ev.evidence.forEach((e2) => { e2.links.testCards = e2.links.testCards.filter((x) => x !== t.id); });
                    Store.save(); App.go("testcards");
                  }) }, "🗑")));
          })))));
    }

    container.appendChild(view);
    if (params.open) {
      const tc = ev.testCards.find((t) => t.id === params.open);
      if (tc) openCard(ev, tc);
    }
  }

  /* ------------------------------------------------------ scenario library */
  function addFromLibrary(ev) {
    const pick = UI.checkList(DCS_TEMPLATE.TEST_CARD_LIBRARY.map((l, i) =>
      ({ value: String(i), label: `${l.title} — proves: ${l.proves}` })), [], "lib");
    UI.modal("Add Test Cards from Scenario Library",
      el("div", {},
        el("p", { class: "card-hint" }, "Proven DCS scenario patterns. Each card arrives pre-linked to the checklist items it provides evidence for."),
        pick), [
      { label: "Cancel", onclick: () => {} },
      { label: "Add Selected", primary: true, onclick: () => {
          const idxs = UI.checkedValues(pick.parentNode, "lib").map(Number);
          if (!idxs.length) { UI.toast("Select at least one scenario.", "error"); return false; }
          idxs.forEach((i) => {
            const l = DCS_TEMPLATE.TEST_CARD_LIBRARY[i];
            ev.testCards.push({
              id: Store.uid("TC"), title: l.title, dcsUseCase: l.dcsUseCase, scenario: l.scenario,
              missionThreadId: "", assetId: "", requestor: "", requestorAttributes: "",
              accessAction: l.accessAction, expectedOutcome: l.expectedOutcome,
              actualOutcome: "", pdpResult: "", pepResult: "",
              decisionLatencyMs: null, enforcementLatencyMs: null,
              score: null, result: null, day: "", hotwashNotes: "",
              checklistIds: l.checklistIds.slice(), evidenceIds: [], createdAt: Store.nowISO()
            });
          });
          Store.save();
          UI.toast(`Added ${idxs.length} test card(s).`);
          App.go("testcards");
        } }]);
  }

  /* ------------------------------------------------------------- drill-in */
  function openCard(ev, t) {
    const mismatch = t.actualOutcome && t.expectedOutcome && t.actualOutcome !== t.expectedOutcome;
    UI.drawer(t.title, t.dcsUseCase || "Test Card", el("div", {},
      UI.attribution(t),
      mismatch ? el("div", { class: "gate-note" },
        el("strong", {}, "Outcome mismatch: "), `expected “${t.expectedOutcome}”, observed “${t.actualOutcome}”.`) : null,
      el("dl", { class: "detail-list" },
        el("dt", {}, "Scenario"), el("dd", {}, t.scenario || "—"),
        el("dt", {}, "Mission Thread"), el("dd", {}, (ev.missionThreads.find((m) => m.id === t.missionThreadId) || {}).name || "—"),
        el("dt", {}, "Protected Data Object"), el("dd", {}, (ev.assets.find((a) => a.id === t.assetId) || {}).name || "—"),
        el("dt", {}, "Requestor"), el("dd", {}, t.requestor || "—"),
        el("dt", {}, "Requestor Attributes"), el("dd", {}, t.requestorAttributes || "—"),
        el("dt", {}, "Access Action"), el("dd", {}, t.accessAction || "—"),
        el("dt", {}, "Expected Outcome"), el("dd", {}, UI.badge(t.expectedOutcome || "—", "info")),
        el("dt", {}, "Actual Outcome"), el("dd", {}, t.actualOutcome ? UI.badge(t.actualOutcome, mismatch ? "critical" : "good") : "not yet run"),
        el("dt", {}, "PDP Result"), el("dd", {}, t.pdpResult || "—"),
        el("dt", {}, "PEP Result"), el("dd", {}, t.pepResult || "—"),
        el("dt", {}, "Decision Latency"), el("dd", {}, t.decisionLatencyMs !== null && t.decisionLatencyMs !== "" ? `${t.decisionLatencyMs} ms` : "—"),
        el("dt", {}, "Enforcement Latency"), el("dd", {}, t.enforcementLatencyMs !== null && t.enforcementLatencyMs !== "" ? `${t.enforcementLatencyMs} ms` : "—"),
        el("dt", {}, "Score / Result"), el("dd", {}, UI.scorePill(t.score), " ", UI.resultBadge(t.result)),
        el("dt", {}, "Execution Day"), el("dd", {}, t.day || "—"),
        el("dt", {}, "Hotwash Notes"), el("dd", {}, t.hotwashNotes || "—")),

      el("h4", { class: "drawer-h" }, "Checklist Items This Test Proves"),
      t.checklistIds.length ? el("ul", { class: "mini-list" }, t.checklistIds.map((id) => {
        const item = ev.checklist.find((c) => c.id === id);
        const tpl = Store.templateItem(id);
        if (!tpl) return null;
        return el("li", { class: "mini-row clickable", onclick: () => { UI.closeDrawer(); App.go("checklist", { open: id }); } },
          UI.scorePill(item ? item.score : null), el("span", { class: "mini-id" }, id),
          el("span", { class: "mini-title" }, tpl.requirement));
      })) : el("p", { class: "empty-mini" }, "No checklist links yet."),

      el("h4", { class: "drawer-h" }, `Evidence (${t.evidenceIds.length})`),
      t.evidenceIds.length ? el("ul", { class: "mini-list" }, t.evidenceIds.map((id) => {
        const e = ev.evidence.find((x) => x.id === id);
        return e ? el("li", { class: "mini-row clickable", onclick: () => { UI.closeDrawer(); App.go("evidence", { open: id }); } },
          UI.qualityBadge(e.quality), el("span", { class: "mini-title" }, e.title)) : null;
      })) : el("p", { class: "empty-mini" }, "No evidence attached — a completed test without evidence cannot be defended."),

      el("div", { class: "drawer-actions" },
        el("button", { class: "btn btn-primary", onclick: () => { UI.closeDrawer(); editCard(ev, t); } }, "Edit / Record Result"),
        t.result === "fail" ? el("button", { class: "btn btn-danger-ghost", onclick: () => {
            UI.closeDrawer();
            ViewFindings.editFinding(ev, null, {
              title: `Test failure: ${t.title}`,
              severity: "major",
              domainId: (Store.templateItem(t.checklistIds[0]) || {}).domainId || "D06",
              impact: `Expected “${t.expectedOutcome}” but observed “${t.actualOutcome || "no result"}”. ${t.hotwashNotes || ""}`.trim(),
              checklistIds: t.checklistIds.slice(), testCardIds: [t.id],
              evidenceIds: t.evidenceIds.slice(), missionThreadId: t.missionThreadId || ""
            }, () => App.go("testcards", { open: t.id }));
          } }, "Convert Failure to Finding") : null)));
  }

  /* ----------------------------------------------------------- edit form */
  function editCard(ev, t) {
    const isNew = !t;
    const data = t || {
      id: Store.uid("TC"), title: "", dcsUseCase: "", scenario: "",
      missionThreadId: "", assetId: "", requestor: "", requestorAttributes: "",
      accessAction: "read", expectedOutcome: "allow", actualOutcome: "",
      pdpResult: "", pepResult: "", decisionLatencyMs: null, enforcementLatencyMs: null,
      score: null, result: null, day: "", hotwashNotes: "",
      checklistIds: [], evidenceIds: [], createdAt: Store.nowISO()
    };

    const titleI = input({ value: data.title });
    const useI = input({ value: data.dcsUseCase, placeholder: "e.g., Partner release control" });
    const scenI = textarea({ value: data.scenario, rows: 3 });
    const mtS = select([{ value: "", label: "—" }, ...ev.missionThreads.map((m) => ({ value: m.id, label: m.name }))], data.missionThreadId);
    const astS = select([{ value: "", label: "—" }, ...ev.assets.map((a) => ({ value: a.id, label: a.name }))], data.assetId);
    const reqI = input({ value: data.requestor, placeholder: "User / system requesting access" });
    const attrI = textarea({ value: data.requestorAttributes, rows: 2, placeholder: "Identity, role, org, nationality, clearance, device posture…" });
    const actS = select(DCS_TEMPLATE.ACCESS_ACTIONS, data.accessAction);
    const expS = select(DCS_TEMPLATE.OUTCOME_ACTIONS, data.expectedOutcome);
    const actualS = select([{ value: "", label: "not run" }, ...DCS_TEMPLATE.OUTCOME_ACTIONS.map((o) => ({ value: o, label: o }))], data.actualOutcome);
    const pdpI = input({ value: data.pdpResult, placeholder: "e.g., DENY (reason: REL-NOMATCH-004)" });
    const pepI = input({ value: data.pepResult, placeholder: "e.g., 403 returned; logged" });
    const dlI = input({ type: "number", value: data.decisionLatencyMs ?? "", placeholder: "ms" });
    const elI = input({ type: "number", value: data.enforcementLatencyMs ?? "", placeholder: "ms" });
    const scoreS = select([{ value: "", label: "Unscored" },
      ...DCS_TEMPLATE.SCORE_RUBRIC.map((r) => ({ value: String(r.score), label: `${r.score} — ${r.label}` }))],
      data.score === null ? "" : String(data.score));
    const resS = select([{ value: "", label: "—" }, ...DCS_TEMPLATE.RESULT_STATES.map((r) => ({ value: r.id, label: r.label }))], data.result || "");
    const dayS = select([{ value: "", label: "—" }, ...DCS_TEMPLATE.EXECUTION_MODEL.map((d) => ({ value: d.day, label: d.day }))], data.day);
    const hwI = textarea({ value: data.hotwashNotes, rows: 3 });
    const clPick = UI.checkList(DCS_TEMPLATE.CHECKLIST.map((c) => ({ value: c.id, label: `${c.id} — ${c.requirement}` })), data.checklistIds, "tc-cl");
    const evPick = UI.checkList(ev.evidence.map((e) => ({ value: e.id, label: `${e.title} (${e.type})` })), data.evidenceIds, "tc-ev");

    UI.modal(isNew ? "New Test Card" : `Edit ${data.title}`, el("div", {},
      el("div", { class: "form-grid" },
        field("Title", titleI), field("DCS Use Case", useI)),
      field("Scenario — what will be tested", scenI),
      el("div", { class: "form-grid" },
        field("Mission Thread", mtS), field("Protected Data Object", astS),
        field("Requestor (user / system)", reqI), field("Access Action", actS),
        field("Expected Outcome", expS), field("Actual Outcome", actualS),
        field("PDP Result / Reason Code", pdpI), field("PEP Result", pepI),
        field("Decision Latency (ms)", dlI), field("Enforcement Latency (ms)", elI),
        field("Score (0–4)", scoreS), field("Result", resS),
        field("Execution Day", dayS)),
      field("Requestor Attributes", attrI),
      field("Hotwash Notes", hwI),
      el("details", { class: "picker-details" },
        el("summary", {}, `Checklist items this test proves (${data.checklistIds.length} linked)`), clPick),
      ev.evidence.length ? el("details", { class: "picker-details" },
        el("summary", {}, `Attach evidence (${data.evidenceIds.length} linked)`), evPick) : null), [
      { label: "Cancel", onclick: () => {} },
      { label: isNew ? "Create Card" : "Save", primary: true, onclick: () => {
          if (!titleI.value.trim()) { UI.toast("Title is required.", "error"); return false; }
          const oldEvidence = data.evidenceIds.slice();
          Object.assign(data, {
            title: titleI.value.trim(), dcsUseCase: useI.value.trim(), scenario: scenI.value.trim(),
            missionThreadId: mtS.value, assetId: astS.value, requestor: reqI.value.trim(),
            requestorAttributes: attrI.value.trim(), accessAction: actS.value,
            expectedOutcome: expS.value, actualOutcome: actualS.value,
            pdpResult: pdpI.value.trim(), pepResult: pepI.value.trim(),
            decisionLatencyMs: dlI.value === "" ? null : parseInt(dlI.value, 10),
            enforcementLatencyMs: elI.value === "" ? null : parseInt(elI.value, 10),
            score: scoreS.value === "" ? null : parseInt(scoreS.value, 10),
            result: resS.value || null, day: dayS.value, hotwashNotes: hwI.value.trim(),
            checklistIds: UI.checkedValues(clPick, "tc-cl"),
            evidenceIds: UI.checkedValues(evPick, "tc-ev")
          });
          if (isNew) ev.testCards.push(data);
          oldEvidence.filter((id) => !data.evidenceIds.includes(id)).forEach((id) => Store.unlinkEvidence(ev, id, "testCards", data.id));
          data.evidenceIds.forEach((id) => Store.linkEvidence(ev, id, "testCards", data.id));
          Store.save();
          App.go("testcards");
        } }]);
  }

  return { render };
})();
