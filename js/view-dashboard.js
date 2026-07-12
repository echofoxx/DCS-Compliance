/* =========================================================================
 * DCS Assessment Command Center — Executive Dashboard view
 * ========================================================================= */

"use strict";

const ViewDashboard = (() => {
  const { el, pct } = UI;

  function render(container) {
    const ev = Store.activeEvent();
    const s = Store.computeScores(ev);
    container.innerHTML = "";

    /* ------------------------------------------------ readiness header */
    const ratingChip = el("span", { class: `rating-chip tone-${s.rating.tone}` },
      el("span", { class: "rating-dot", "aria-hidden": "true" }),
      s.rating.label);

    const gaugeCard = el("div", { class: "card gauge-card" },
      el("h3", { class: "card-title" }, "Overall DCS Readiness"),
      el("div", { class: "gauge-wrap" }, Charts.gauge(s.overallPct)),
      ratingChip,
      s.gated
        ? el("div", { class: "gate-note" },
            "Rating capped: ", el("strong", {}, `${s.criticalItemFails.length} critical checklist failure(s), ${s.openCriticalFindings.length} open critical finding(s).`),
            " Resolve critical gaps to unlock a higher rating.")
        : el("div", { class: "gate-note ok" }, "No critical-gate conditions triggered."));

    /* ------------------------------------------------------- stat tiles */
    const testCards = ev.testCards;
    const testsRun = testCards.filter((t) => t.result).length;
    const testsPassed = testCards.filter((t) => t.result === "pass").length;
    const threadsTested = ev.missionThreads.filter((mt) =>
      testCards.some((t) => t.missionThreadId === mt.id && t.result)).length;
    const denialTests = testCards.filter((t) => ["deny", "quarantine"].includes(t.expectedOutcome) && t.result);
    const denialsHeld = denialTests.filter((t) => t.result === "pass").length;

    const tiles = el("div", { class: "tile-grid" },
      Charts.statTile("Assessment Coverage", pct(s.coverage), {
        sub: "checklist items scored", onclick: () => App.go("checklist") }),
      Charts.statTile("Evidence Completeness", pct(s.evidenceCompleteness), {
        sub: "applicable items with evidence",
        tone: s.evidenceCompleteness < 0.5 ? "warning" : null,
        onclick: () => App.go("checklist", { evidence: "missing" }) }),
      Charts.statTile("Critical Gaps", s.openFindingsBySeverity.critical, {
        tone: s.openFindingsBySeverity.critical ? "critical" : "good",
        sub: "open critical findings", onclick: () => App.go("findings", { severity: "critical" }) }),
      Charts.statTile("Open Findings",
        ev.findings.filter((f) => f.status !== "closed" && f.severity !== "strength").length, {
        sub: "all severities", onclick: () => App.go("findings") }),
      Charts.statTile("Mission Threads Tested", `${threadsTested} of ${ev.missionThreads.length}`, {
        sub: "threads with executed tests", onclick: () => App.go("event", { tab: "threads" }) }),
      Charts.statTile("Test Cards Executed", `${testsRun} of ${testCards.length}`, {
        sub: `${testsPassed} passed`, onclick: () => App.go("testcards") }),
      Charts.statTile("Unauthorized Access Blocks",
        denialTests.length ? `${denialsHeld} / ${denialTests.length}` : "—", {
        tone: denialTests.length && denialsHeld < denialTests.length ? "critical" : (denialTests.length ? "good" : null),
        sub: "denial tests held", onclick: () => App.go("testcards") }),
      Charts.statTile("Evidence Items", ev.evidence.length, {
        sub: "in the evidence locker", onclick: () => App.go("evidence") }));

    /* --------------------------------------------------- domain heatmap */
    const heatCard = el("div", { class: "card" },
      el("h3", { class: "card-title" }, "DCS Capability Heatmap"),
      el("p", { class: "card-hint" }, "Average maturity score (0–4) by assessment domain. Click a domain to open its checklist items."),
      Charts.domainHeatmap(s.domains, (id) => App.go("checklist", { domain: id })),
      el("div", { class: "heat-legend" },
        el("span", {}, "0"),
        el("span", { class: "heat-legend-ramp", "aria-hidden": "true" }),
        el("span", {}, "4")));

    /* -------------------------------------------- domain readiness bars */
    const barsCard = el("div", { class: "card" },
      el("h3", { class: "card-title" }, "Weighted Domain Readiness"),
      el("p", { class: "card-hint" }, "Domain average as a share of the 0–4 scale, with its compliance weight."),
      Charts.barRows(s.domains.map((d) => ({
        label: `${d.short} (${d.weight}%)`,
        value: d.pct,
        display: d.avgScore === null ? "not scored" : `${d.avgScore.toFixed(1)} / 4`,
        onclick: () => App.go("checklist", { domain: d.id }),
        tip: () => `<strong>${UI.esc(d.name)}</strong><br>${d.scoredCount} of ${d.applicable} applicable items scored`
      }))));

    /* ------------------------------------------------- critical findings */
    const openCrit = ev.findings.filter((f) => (f.severity === "critical" || f.severity === "major") && f.status !== "closed");
    const findingsCard = el("div", { class: "card" },
      el("h3", { class: "card-title" }, "Leadership Attention — Critical & Major Findings"),
      openCrit.length
        ? el("ul", { class: "mini-list" }, openCrit.slice(0, 8).map((f) =>
            el("li", { class: "mini-row clickable", onclick: () => App.go("findings", { open: f.id }) },
              UI.severityBadge(f.severity),
              el("span", { class: "mini-title" }, f.title),
              el("span", { class: "mini-meta" }, f.owner || "unassigned"))))
        : UI.empty("No open critical or major findings", "Findings generated from failed checklist items or test cards appear here."));

    /* ----------------------------------------------- evidence gap tracker */
    const gaps = ev.checklist.filter((c) => {
      const scored = c.score !== null && c.result && c.result !== "na" && c.result !== "no";
      return scored && c.evidenceIds.length === 0;
    });
    const gapCard = el("div", { class: "card" },
      el("h3", { class: "card-title" }, "Evidence Gap Tracker"),
      el("p", { class: "card-hint" }, "Scored items with no linked evidence — scores that cannot currently be defended."),
      gaps.length
        ? el("ul", { class: "mini-list" }, gaps.slice(0, 8).map((c) => {
            const t = Store.templateItem(c.id);
            return el("li", { class: "mini-row clickable", onclick: () => App.go("checklist", { open: c.id }) },
              UI.scorePill(c.score),
              el("span", { class: "mini-id" }, c.id),
              el("span", { class: "mini-title" }, t.requirement));
          }))
        : UI.empty("No evidence gaps", "Every scored item has at least one linked evidence record."));

    /* -------------------------------------------- mission thread status */
    const threadCard = el("div", { class: "card" },
      el("h3", { class: "card-title" }, "Mission Thread Readiness"),
      ev.missionThreads.length
        ? el("ul", { class: "mini-list" }, ev.missionThreads.map((mt) => {
            const tests = testCards.filter((t) => t.missionThreadId === mt.id);
            const run = tests.filter((t) => t.result);
            const failed = run.filter((t) => t.result === "fail").length;
            const tone = failed ? "critical" : (run.length && run.length === tests.length ? "good" : (run.length ? "warning" : "muted"));
            return el("li", { class: "mini-row clickable", onclick: () => App.go("event", { tab: "threads", open: mt.id }) },
              UI.badge(failed ? `${failed} failed` : `${run.length}/${tests.length || 0} tests`, tone),
              el("span", { class: "mini-title" }, mt.name),
              el("span", { class: "mini-meta" }, mt.expectedOutcome || ""));
          }))
        : UI.empty("No mission threads defined", "Add mission threads in the Event Workspace to tie checks to operational outcomes."));

    container.appendChild(el("div", { class: "view" },
      el("div", { class: "view-head" },
        el("div", {},
          el("h1", {}, "Executive Dashboard"),
          el("p", { class: "view-sub" },
            `Did the event prove that protected data can be discovered, labeled, governed, accessed, denied, shared, monitored, and audited under Zero Trust conditions?`)),
        el("div", { class: "view-actions" },
          el("button", { class: "btn", onclick: () => App.go("reports") }, "Open Report Builder"))),
      el("div", { class: "dash-top" }, gaugeCard, tiles),
      el("div", { class: "dash-grid" }, heatCard, barsCard, findingsCard, gapCard, threadCard)));
  }

  return { render };
})();
