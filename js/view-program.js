/* =========================================================================
 * DCS Assessment Command Center — Program view
 * Cross-event maturity tracking for a DCS assessment program: compare
 * readiness and domain scores across events, watch maturity trend over
 * the series, and collect reusable control patterns (strengths).
 * ========================================================================= */

"use strict";

const ViewProgram = (() => {
  const { el, pct } = UI;

  const phaseLabel = (id) => (DCS_TEMPLATE.PHASES.find((p) => p.id === id) || {}).label || "—";
  const PHASE_TONE = { planning: "muted", design: "info", execution: "warning", analysis: "info", complete: "good" };

  function render(container) {
    const st = Store.getState();
    container.innerHTML = "";
    const view = el("div", { class: "view" });

    // score every event once, in creation order (the program timeline)
    const events = st.events.slice().sort((a, b) => (a.createdAt || "").localeCompare(b.createdAt || ""));
    const scored = events.map((ev) => ({ ev, s: Store.computeScores(ev) }));

    view.appendChild(el("div", { class: "view-head" },
      el("div", {},
        el("h1", {}, "Assessment Program"),
        el("p", { class: "view-sub" }, "The view across events: is DCS maturity actually improving assessment over assessment, which domains keep lagging, and which control patterns are worth reusing?")),
      el("div", { class: "view-actions" },
        el("button", { class: "btn", onclick: () => Store.exportWorkspaceJSON() }, "Backup All Events"))));

    /* ------------------------------------------------------ events table */
    view.appendChild(el("div", { class: "card table-card" },
      el("h3", { class: "card-title", style: "padding:10px 10px 0" }, "Events"),
      el("table", { class: "data-table" },
        el("thead", {}, el("tr", {},
          ["Event", "Phase", "Window", "Readiness", "Rating", "Coverage", "Evidence", "Open Critical", ""].map((h) => el("th", {}, h)))),
        el("tbody", {}, scored.map(({ ev, s }) =>
          el("tr", { class: "clickable", onclick: () => { Store.setActiveEvent(ev.id); App.go("dashboard"); } },
            el("td", {}, el("strong", {}, ev.name),
              ev.location || ev.eventWindow ? el("div", { class: "cell-sub" }, [ev.location, ev.eventWindow].filter(Boolean).join(" · ")) : null),
            el("td", {}, UI.badge(phaseLabel(ev.phase).replace(/Phase \d · /, ""), PHASE_TONE[ev.phase] || "muted")),
            el("td", {}, ev.eventWindow || "—"),
            el("td", {}, s.overallPct === null ? "—" : pct(s.overallPct)),
            el("td", {}, UI.badge(s.rating.label, s.rating.tone === "muted" ? "muted" : s.rating.tone)),
            el("td", {}, pct(s.coverage)),
            el("td", {}, pct(s.evidenceCompleteness)),
            el("td", {}, s.openFindingsBySeverity.critical
              ? UI.badge(String(s.openFindingsBySeverity.critical), "critical") : UI.badge("0", "good")),
            el("td", { onclick: (e) => e.stopPropagation() },
              el("button", { class: "btn small", title: "Start the next assessment from this event's setup", onclick: () => {
                  const copy = Store.duplicateEventAsTemplate(ev.id);
                  UI.toast(`Created “${copy.name}” with a fresh checklist.`);
                  App.go("event");
                } }, "Reuse"))))))));

    /* ------------------------------------------------ readiness trend */
    const rated = scored.filter(({ s }) => s.overallPct !== null);
    view.appendChild(el("div", { class: "card" },
      el("h3", { class: "card-title" }, "Readiness Trend Across Events"),
      el("p", { class: "card-hint" }, "Weighted overall readiness per event, in program order. A capped (critical-gated) rating is flagged even when the percentage looks healthy."),
      rated.length
        ? Charts.barRows(rated.map(({ ev, s }) => ({
            label: ev.name.length > 26 ? ev.name.slice(0, 24) + "…" : ev.name,
            value: s.overallPct,
            display: `${Math.round(s.overallPct * 100)}%${s.gated ? " ⚑" : ""}`,
            onclick: () => { Store.setActiveEvent(ev.id); App.go("dashboard"); },
            tip: () => `<strong>${UI.esc(ev.name)}</strong><br>${UI.esc(s.rating.label)}${s.gated ? "<br>⚑ rating capped by a critical gap" : ""}`
          })))
        : UI.empty("No scored events yet", "Once checklist items are scored, each event appears here as a point on the maturity trend.")));

    /* -------------------------------------- domain × event score matrix */
    if (rated.length) {
      const table = el("table", { class: "data-table compact matrix-table" },
        el("thead", {}, el("tr", {},
          el("th", {}, "DCS Domain"),
          rated.map(({ ev }) => el("th", { title: ev.name }, ev.name.length > 18 ? ev.name.slice(0, 16) + "…" : ev.name)),
          el("th", {}, "Δ first → latest"))),
        el("tbody", {}, DCS_TEMPLATE.DOMAINS.map((d) => {
          const cells = rated.map(({ s }) => {
            const ds = s.domains.find((x) => x.id === d.id);
            return ds && ds.avgScore !== null ? ds.avgScore : null;
          });
          const known = cells.filter((v) => v !== null);
          const delta = known.length >= 2 ? known[known.length - 1] - known[0] : null;
          return el("tr", {},
            el("td", {}, el("strong", {}, d.short), el("div", { class: "cell-sub" }, d.name)),
            cells.map((v) => el("td", {},
              el("span", {
                class: `matrix-cell${v === null ? " empty" : (v / 4 < 0.5 ? " light" : "")}`,
                style: v === null ? null : `--cell:${Charts.seqColor(v / 4)}`
              }, v === null ? "–" : v.toFixed(1)))),
            el("td", {}, delta === null ? "—" :
              el("span", { class: `badge tone-${delta > 0.05 ? "good" : delta < -0.05 ? "critical" : "muted"}` },
                `${delta > 0 ? "+" : ""}${delta.toFixed(1)}`)));
        })));
      view.appendChild(el("div", { class: "card table-card" },
        el("h3", { class: "card-title", style: "padding:10px 10px 0" }, "Domain Maturity by Event"),
        el("p", { class: "card-hint", style: "padding:0 10px" }, "Average 0–4 score per domain per event. The Δ column shows movement from the first scored event to the latest — this is the roadmap conversation with leadership."),
        table));
    }

    /* -------------------------------------- reusable patterns library */
    const strengths = [];
    const openCriticals = [];
    events.forEach((ev) => {
      ev.findings.forEach((f) => {
        if (f.severity === "strength") strengths.push({ ev, f });
        else if (f.severity === "critical" && f.status !== "closed") openCriticals.push({ ev, f });
      });
    });

    view.appendChild(el("div", { class: "two-col" },
      el("div", { class: "card" },
        el("h3", { class: "card-title" }, "Reusable Control Patterns (Strengths)"),
        el("p", { class: "card-hint" }, "Strength findings across the whole program — the patterns to carry into the next assessment."),
        strengths.length
          ? el("ul", { class: "mini-list" }, strengths.map(({ ev, f }) =>
              el("li", { class: "mini-row clickable", onclick: () => { Store.setActiveEvent(ev.id); App.go("findings", { open: f.id }); } },
                UI.severityBadge("strength"),
                el("span", { class: "mini-title" }, f.title),
                el("span", { class: "mini-meta" }, ev.name))))
          : UI.empty("No strengths recorded yet", "Record what worked as Strength findings — they become the reuse library for future events.")),
      el("div", { class: "card" },
        el("h3", { class: "card-title" }, "Program-Level Open Critical Gaps"),
        el("p", { class: "card-hint" }, "Unresolved critical findings anywhere in the program. These carry risk forward into the next event."),
        openCriticals.length
          ? el("ul", { class: "mini-list" }, openCriticals.map(({ ev, f }) =>
              el("li", { class: "mini-row clickable", onclick: () => { Store.setActiveEvent(ev.id); App.go("findings", { open: f.id }); } },
                UI.severityBadge("critical"),
                el("span", { class: "mini-title" }, f.title),
                el("span", { class: "mini-meta" }, ev.name))))
          : UI.empty("No open critical gaps", "All critical findings across the program are closed."))));

    container.appendChild(view);
  }

  return { render };
})();
