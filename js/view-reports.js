/* =========================================================================
 * DCS Assessment Command Center — Report Builder view
 * Generates a print-ready final assessment report (use the browser's
 * Print → Save as PDF) plus CSV/JSON export bundles.
 * ========================================================================= */

"use strict";

const ViewReports = (() => {
  const { el, pct, esc } = UI;

  const SECTIONS = [
    { id: "exec",      label: "Executive Summary",                   default: true },
    { id: "scope",     label: "Event Scope & DCS Use Cases",         default: true },
    { id: "method",    label: "Assessment Methodology",              default: true },
    { id: "scorecard", label: "DCS Checklist Scorecard (by domain)", default: true },
    { id: "checklist", label: "Detailed Checklist Results",          default: true },
    { id: "tests",     label: "Scenario Test Results (expected vs actual)", default: true },
    { id: "findings",  label: "Findings & Recommendations",          default: true },
    { id: "standards", label: "Standards Coverage",                  default: false },
    { id: "evidence",  label: "Evidence Index",                      default: true },
    { id: "daily",     label: "Daily Rollups / Hotwash",             default: false },
    { id: "roadmap",   label: "30 / 60 / 90 / 180-Day Roadmap",      default: true }
  ];

  const selected = new Set(SECTIONS.filter((s) => s.default).map((s) => s.id));

  function render(container) {
    const ev = Store.activeEvent();
    container.innerHTML = "";
    const view = el("div", { class: "view" });

    view.appendChild(el("div", { class: "view-head" },
      el("div", {},
        el("h1", {}, "Report Builder"),
        el("p", { class: "view-sub" }, "Assemble the final assessment package. The generated report opens print-ready — use Print → Save as PDF for the deliverable.")),
      el("div", { class: "view-actions" },
        el("button", { class: "btn btn-primary", onclick: () => buildReport(ev) }, "Generate Report"))));

    const secPick = el("div", { class: "card" },
      el("h3", { class: "card-title" }, "Report Sections"),
      el("div", { class: "rm-grid" }, SECTIONS.map((s) =>
        el("label", { class: "check-row" },
          el("input", { type: "checkbox", checked: selected.has(s.id), onchange: (e) => {
            e.target.checked ? selected.add(s.id) : selected.delete(s.id);
          } }),
          el("span", {}, s.label)))));

    const exports = el("div", { class: "card" },
      el("h3", { class: "card-title" }, "Data Exports"),
      el("p", { class: "card-hint" }, "Machine-readable exports for the appendix package, cross-event comparison, or ingestion into other tools."),
      el("div", { class: "export-grid" },
        el("button", { class: "btn", onclick: () => Store.exportChecklistCSV(ev) }, "Checklist (CSV)"),
        el("button", { class: "btn", onclick: () => Store.exportFindingsCSV(ev) }, "Findings (CSV)"),
        el("button", { class: "btn", onclick: () => Store.exportEvidenceCSV(ev) }, "Evidence Index (CSV)"),
        el("button", { class: "btn", onclick: () => Store.exportEventJSON(ev) }, "Full Event (JSON)"),
        el("button", { class: "btn", onclick: () => Store.exportWorkspaceJSON() }, "Workspace Backup (JSON)")));

    /* editable executive narrative, included in the report's exec summary */
    const narrI = el("textarea", { class: "input", rows: 5,
      placeholder: "Assessor-owned narrative for the executive summary: what the event demonstrated and the leadership takeaway. Left empty, the report shows metrics only.",
      value: ev.execNarrative || "" });
    const narrCard = el("div", { class: "card" },
      el("h3", { class: "card-title" }, "Executive Narrative"),
      el("p", { class: "card-hint" }, "Appears at the top of the report's Executive Summary. The assessor owns this text."),
      narrI,
      el("div", { class: "ai-row" },
        el("button", { class: "btn btn-primary", onclick: () => {
            ev.execNarrative = narrI.value.trim();
            Store.save();
            UI.toast("Narrative saved.");
          } }, "Save Narrative"),
        Assistant.draftButton("Draft from current scores & findings", async () => {
          narrI.value = await Assistant.draftNarrative(ev, Store.computeScores(ev));
        }),
        el("span", { class: "field-hint" }, "The draft is grounded only in this event's recorded scores and findings — review and edit before saving.")));

    view.appendChild(el("div", { class: "two-col" }, secPick, exports));
    view.appendChild(narrCard);
    view.appendChild(el("div", { id: "report-preview" }));
    container.appendChild(view);
  }

  /* ---------------------------------------------------------- report HTML */
  function buildReport(ev) {
    const s = Store.computeScores(ev);
    const h = [];
    const has = (id) => selected.has(id);
    const scoreLabel = (v) => v === null ? "—" : DCS_TEMPLATE.SCORE_RUBRIC[Math.round(v)].label;
    const sevLabel = (id) => (DCS_TEMPLATE.SEVERITIES.find((x) => x.id === id) || {}).label || id;

    h.push(`<div class="rpt-cover">
      <div class="rpt-class">${esc(ev.classification)}</div>
      <h1>DCS Compliance Assessment Report</h1>
      <h2>${esc(ev.name)}</h2>
      <p>${esc(ev.location || "")}${ev.location && ev.eventWindow ? " · " : ""}${esc(ev.eventWindow || "")}</p>
      <p>Assessment period: ${esc(ev.assessmentPeriod || "—")}</p>
      <p>Generated ${new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })} · DCS Assessment Command Center</p>
    </div>`);

    if (has("exec")) {
      const openCrit = s.openCriticalFindings.length;
      const strengths = ev.findings.filter((f) => f.severity === "strength");
      h.push(`<section><h2>1. Executive Summary</h2>
        ${ev.execNarrative ? `<p>${esc(ev.execNarrative).replace(/\n\n+/g, "</p><p>").replace(/\n/g, "<br>")}</p>` : ""}
        <table class="rpt-kv">
          <tr><th>Overall DCS readiness</th><td>${pct(s.overallPct)} — <strong>${esc(s.rating.label)}</strong></td></tr>
          <tr><th>Assessment coverage</th><td>${pct(s.coverage)} of applicable checklist items scored</td></tr>
          <tr><th>Evidence completeness</th><td>${pct(s.evidenceCompleteness)} of applicable items have linked evidence</td></tr>
          <tr><th>Open critical findings</th><td>${openCrit}</td></tr>
          <tr><th>Open major findings</th><td>${s.openFindingsBySeverity.major}</td></tr>
          <tr><th>Strengths identified</th><td>${strengths.length}</td></tr>
        </table>
        ${s.gated ? `<p class="rpt-alert"><strong>Rating gate applied:</strong> the overall rating is capped at “Not Ready — Critical Gap” because ${s.criticalItemFails.length} critical checklist item(s) failed and ${openCrit} critical finding(s) remain open. ${s.redFlags.length ? "Red flags triggered: " + s.redFlags.map((r) => esc(r.label)).join("; ") + "." : ""}</p>` : ""}
        <p>Core assessment question: can the event demonstrate that DCS controls make mission data available to authorized users under the right conditions, prevent unauthorized access or over-sharing, preserve protection context as data moves, and produce enough evidence to prove compliance and operational value?</p>
      </section>`);
    }

    if (has("scope")) {
      h.push(`<section><h2>2. Event Scope & DCS Use Cases</h2>
        <table class="rpt-kv">
          <tr><th>Objectives</th><td>${ev.objectives.map(esc).join("<br>") || "—"}</td></tr>
          <tr><th>Participating organizations</th><td>${ev.organizations.map(esc).join(", ") || "—"}</td></tr>
          <tr><th>Standards alignment</th><td>${ev.standards.map(esc).join("<br>") || "—"}</td></tr>
          <tr><th>Systems in scope</th><td>${ev.systems.map((x) => esc(`${x.name} (${x.layer || "—"})`)).join("<br>") || "—"}</td></tr>
        </table>
        <h3>Mission Threads</h3>
        ${ev.missionThreads.length ? `<table class="rpt-table"><tr><th>Thread</th><th>Operational User</th><th>Partner</th><th>DCS Action</th><th>Expected Outcome</th></tr>
          ${ev.missionThreads.map((m) => `<tr><td>${esc(m.name)}</td><td>${esc(m.operationalUser || "—")}</td><td>${esc(m.partnerUser || "—")}</td><td>${esc(m.dcsAction || "—")}</td><td>${esc(m.expectedOutcome || "—")}</td></tr>`).join("")}</table>` : "<p>No mission threads defined.</p>"}
        <h3>Protected Data Objects</h3>
        ${ev.assets.length ? `<table class="rpt-table"><tr><th>Asset</th><th>Type</th><th>Owner / Steward</th><th>Classification</th><th>Releasability</th><th>Risk</th></tr>
          ${ev.assets.map((a) => `<tr><td>${esc(a.name)}</td><td>${esc(a.type || "—")}</td><td>${esc((a.owner || "—") + " / " + (a.steward || "—"))}</td><td>${esc(a.classification || "—")}</td><td>${esc(a.releasability || "—")}</td><td>${esc(a.riskRating || "—")}</td></tr>`).join("")}</table>` : "<p>No protected data objects registered.</p>"}
      </section>`);
    }

    if (has("method")) {
      // Assessment Scope Statement — auto-generated from framework mode +
      // per-item scope decisions. Groups scope reasons by domain so the
      // report reads as a coherent explanation.
      const modeMeta = DCS_TEMPLATE.FRAMEWORK_MODES.find((m) => m.id === (ev.frameworkMode || "combined")) || {};
      const outByDomain = new Map();
      ev.checklist.forEach((c) => {
        if ((c.scope || "in_scope") === "in_scope") return;
        const d = Store.domain(Store.templateItem(c.id).domainId);
        if (!outByDomain.has(d.name)) outByDomain.set(d.name, []);
        outByDomain.get(d.name).push({ id: c.id, reason: c.scopeReason || "no reason recorded" });
      });
      const scopeRows = [...outByDomain.entries()].map(([dName, list]) => {
        const reasons = [...new Set(list.map((x) => x.reason))].join("; ");
        return `<tr><td>${esc(dName)}</td><td>${list.length}</td><td>${list.map((x) => x.id).join(", ")}</td><td>${esc(reasons)}</td></tr>`;
      }).join("");
      const modeExcluded = ev.checklist.filter((c) => (c.scope || "in_scope") === "in_scope"
        && !Store.itemInFrameworkMode(c.id, ev.frameworkMode)).length;

      h.push(`<section><h2>3. Assessment Methodology</h2>
        <h3>Assessment Scope</h3>
        <table class="rpt-kv">
          <tr><th>Framework Mode</th><td><strong>${esc(modeMeta.label || ev.frameworkMode)}</strong> — ${esc(modeMeta.hint || "")}</td></tr>
          <tr><th>Items in scope</th><td>${s.inScopeCount} of ${ev.checklist.length}</td></tr>
          <tr><th>Items out of scope</th><td>${s.outOfScopeCount}${modeExcluded ? ` (${modeExcluded} excluded by framework mode; the rest by explicit scope decision)` : ""}</td></tr>
          ${ev.frameworkMode === "custom" && ev.customScopeNote ? `<tr><th>Custom scope rationale</th><td>${esc(ev.customScopeNote)}</td></tr>` : ""}
        </table>
        ${scopeRows ? `<h4>Excluded items by domain</h4>
          <table class="rpt-table"><tr><th>Domain</th><th># Excluded</th><th>Item IDs</th><th>Reason(s)</th></tr>${scopeRows}</table>` : ""}
        <h3>Scoring Approach</h3>
        <p>Items were scored with a 0–4 maturity rubric and a Pass / Partial / Fail / Not-Observed / N/A result. A checklist item is not marked complete unless the assessor can point to objective evidence (log entry, policy decision, enforcement result, screenshot, export, or signed observation note). The overall readiness score blends domain averages using the compliance weights, over in-scope items only; any failed critical in-scope item or open critical finding caps the overall rating regardless of the weighted score. Out-of-scope items are excluded from every calculation.</p>
        <table class="rpt-table"><tr><th>Score</th><th>Meaning</th></tr>
        ${DCS_TEMPLATE.SCORE_RUBRIC.map((r) => `<tr><td>${r.score} — ${esc(r.label)}</td><td>${esc(r.meaning)}</td></tr>`).join("")}</table>
      </section>`);
    }

    if (has("scorecard")) {
      h.push(`<section><h2>4. DCS Checklist Scorecard</h2>
        <table class="rpt-table"><tr><th>Domain</th><th>Weight</th><th>Items Scored</th><th>Avg Score</th><th>Maturity</th><th>Evidence Coverage</th><th>Failures</th></tr>
        ${s.domains.map((d) => `<tr><td>${esc(d.name)}</td><td>${d.weight}%</td><td>${d.scoredCount} / ${d.applicable}</td><td>${d.avgScore === null ? "—" : d.avgScore.toFixed(1)} / 4</td><td>${esc(scoreLabel(d.avgScore))}</td><td>${Math.round(d.evidencePct * 100)}%</td><td>${d.failures || ""}</td></tr>`).join("")}
        <tr class="rpt-total"><td><strong>Overall (weighted)</strong></td><td>100%</td><td colspan="2"><strong>${pct(s.overallPct)}</strong></td><td colspan="3"><strong>${esc(s.rating.label)}</strong></td></tr></table>
      </section>`);
    }

    if (has("checklist")) {
      // In-scope items only; a summary line names how many were excluded.
      const rows = DCS_TEMPLATE.DOMAINS.map((d) => {
        const items = ev.checklist.filter((c) =>
          Store.templateItem(c.id).domainId === d.id && Store.isInScope(ev, c));
        if (!items.length) return "";
        return `<tr class="rpt-domain"><td colspan="6">${esc(d.code)} ${esc(d.name)}</td></tr>` +
          items.map((c) => {
            const t = Store.templateItem(c.id);
            return `<tr><td>${c.id}</td><td>${esc(t.requirement)}</td><td>${c.score ?? "—"}</td><td>${esc((DCS_TEMPLATE.RESULT_STATES.find((r) => r.id === c.result) || {}).label || "—")}</td><td>${c.evidenceIds.length}</td><td>${esc(c.notes || "")}</td></tr>`;
          }).join("");
      }).join("");
      h.push(`<section><h2>5. Detailed Checklist Results</h2>
        <p><em>${s.inScopeCount} in-scope items shown.${s.outOfScopeCount ? ` ${s.outOfScopeCount} item(s) are out of scope for this assessment — see Section 3 Assessment Scope for reasons.` : ""}</em></p>
        <table class="rpt-table"><tr><th>ID</th><th>Compliance Check</th><th>Score</th><th>Result</th><th>Evidence</th><th>Assessor Notes</th></tr>${rows}</table>
      </section>`);
    }

    if (has("tests")) {
      h.push(`<section><h2>6. Scenario Test Results</h2>
        ${ev.testCards.length ? `<table class="rpt-table"><tr><th>Test</th><th>Mission Thread</th><th>Expected</th><th>Actual</th><th>PDP / PEP</th><th>Score</th><th>Result</th></tr>
        ${ev.testCards.map((t) => {
          const mm = t.actualOutcome && t.expectedOutcome && t.actualOutcome !== t.expectedOutcome;
          return `<tr><td>${esc(t.title)}</td><td>${esc((ev.missionThreads.find((m) => m.id === t.missionThreadId) || {}).name || "—")}</td><td>${esc(t.expectedOutcome || "—")}</td><td>${mm ? "<strong>" : ""}${esc(t.actualOutcome || "not run")}${mm ? "</strong> ⚠" : ""}</td><td>${esc([t.pdpResult, t.pepResult].filter(Boolean).join(" / ") || "—")}</td><td>${t.score ?? "—"}</td><td>${esc((DCS_TEMPLATE.RESULT_STATES.find((r) => r.id === t.result) || {}).label || "—")}</td></tr>`;
        }).join("")}</table>` : "<p>No test cards defined.</p>"}
      </section>`);
    }

    if (has("findings")) {
      const rank = { critical: 0, major: 1, moderate: 2, observation: 3, strength: 4 };
      const list = ev.findings.slice().sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9));
      h.push(`<section><h2>7. Findings & Recommendations</h2>
        ${list.length ? list.map((f, i) => `<div class="rpt-finding">
          <h3>${i + 1}. ${esc(f.title)} <span class="rpt-sev rpt-sev-${f.severity}">${esc(sevLabel(f.severity))}</span></h3>
          <table class="rpt-kv">
            <tr><th>Impact</th><td>${esc(f.impact || "—")}</td></tr>
            <tr><th>Recommendation</th><td>${esc(f.recommendation || "—")}</td></tr>
            <tr><th>Owner / Due / Status</th><td>${esc(f.owner || "unassigned")} · ${esc(f.dueDate || "no due date")} · ${esc((ViewFindings.STATUSES.find((x) => x.id === f.status) || {}).label || f.status)}</td></tr>
            <tr><th>Traceability</th><td>${esc([
              f.missionThreadId ? "Thread: " + ((ev.missionThreads.find((m) => m.id === f.missionThreadId) || {}).name || "") : "",
              f.checklistIds.length ? "Checks: " + f.checklistIds.join(", ") : "",
              f.testCardIds.length ? "Tests: " + f.testCardIds.map((id) => (ev.testCards.find((t) => t.id === id) || {}).title).filter(Boolean).join("; ") : "",
              f.evidenceIds.length ? "Evidence: " + f.evidenceIds.length + " item(s)" : ""
            ].filter(Boolean).join(" · ") || "—")}</td></tr>
          </table></div>`).join("") : "<p>No findings recorded.</p>"}
      </section>`);
    }

    if (has("standards")) {
      const map = new Map();
      ev.checklist.forEach((c) => {
        const t = Store.templateItem(c.id);
        t.standards.forEach((std) => {
          if (!map.has(std)) map.set(std, { total: 0, scored: 0, failed: 0 });
          const m = map.get(std);
          m.total++;
          if (c.score !== null && c.result !== "na") m.scored++;
          if (c.result === "fail") m.failed++;
        });
      });
      h.push(`<section><h2>8. Standards Coverage</h2>
        <table class="rpt-table"><tr><th>Standard / Control Family</th><th>Mapped Items</th><th>Assessed</th><th>Failed</th></tr>
        ${[...map.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([std, m]) =>
          `<tr><td>${esc(std)}</td><td>${m.total}</td><td>${m.scored}</td><td>${m.failed || ""}</td></tr>`).join("")}</table>
      </section>`);
    }

    if (has("evidence")) {
      h.push(`<section><h2>9. Evidence Index</h2>
        ${ev.evidence.length ? `<table class="rpt-table"><tr><th>ID</th><th>Title</th><th>Type</th><th>Source</th><th>Captured By</th><th>Handling</th><th>Quality</th><th>Linked To</th></tr>
        ${ev.evidence.map((e2) => `<tr><td>${esc(e2.id)}</td><td>${esc(e2.title)}</td><td>${esc(e2.type)}</td><td>${esc(e2.sourceSystem || "—")}</td><td>${esc(e2.capturedBy || "—")}</td><td>${esc(e2.classification || "—")}</td><td>${esc(e2.quality || "—")}</td><td>${esc([...e2.links.checklist, ...e2.links.testCards.map(() => "test"), ...e2.links.findings.map(() => "finding")].join(", ") || "—")}</td></tr>`).join("")}</table>` : "<p>No evidence recorded.</p>"}
      </section>`);
    }

    if (has("daily")) {
      h.push(`<section><h2>10. Daily Rollups</h2>
        ${ev.dailyLogs.length ? ev.dailyLogs.map((l) => `<div class="rpt-finding"><h3>${esc(l.day)}${l.date ? " — " + esc(l.date) : ""} · ${esc(l.focus || "")}</h3>
          <table class="rpt-kv">
            <tr><th>Summary</th><td>${esc(l.summary || "—")}</td></tr>
            <tr><th>Issues</th><td>${esc(l.issues || "—")}</td></tr>
            <tr><th>Decisions</th><td>${esc(l.decisions || "—")}</td></tr>
            <tr><th>Actions</th><td>${esc(l.actions || "—")}</td></tr>
          </table></div>`).join("") : "<p>No daily rollups recorded.</p>"}
      </section>`);
    }

    if (has("roadmap")) {
      h.push(`<section><h2>11. 30 / 60 / 90 / 180-Day Roadmap</h2>
        <table class="rpt-table"><tr><th>Timeframe</th><th>Recommended DCS Actions</th></tr>
        ${DCS_TEMPLATE.ROADMAP.map((r) => `<tr><td><strong>${esc(r.horizon)}</strong></td><td>${esc(r.actions)}</td></tr>`).join("")}</table>
        <p><em>Bottom line: a successful event demonstrates that DCS controls are governed, integrated, enforceable, auditable, and operationally useful across mission workflows.</em></p>
      </section>`);
    }

    h.push(`<div class="rpt-class">${esc(ev.classification)}</div>`);

    const preview = document.getElementById("report-preview");
    preview.innerHTML = "";
    preview.appendChild(el("div", { class: "card report-card" },
      el("div", { class: "list-toolbar no-print" },
        el("h3", { class: "card-title" }, "Report Preview"),
        el("button", { class: "btn btn-primary", onclick: () => window.print() }, "Print / Save as PDF")),
      el("div", { class: "rpt", id: "printable-report", html: h.join("\n") })));
    preview.scrollIntoView({ behavior: "smooth" });
    UI.toast("Report generated below — use Print / Save as PDF for the deliverable.");
  }

  return { render };
})();
