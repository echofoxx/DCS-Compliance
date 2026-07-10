/* =========================================================================
 * DCS Assessment Command Center — Charts
 * Inline-SVG / HTML chart components. Palette follows the validated
 * reference data-viz palette: sequential blue for magnitude, reserved
 * status colors for state, direct labels on marks (relief rule).
 * ========================================================================= */

"use strict";

const Charts = (() => {
  const { el } = UI;

  // Sequential blue ramp (light-mode steps 100→700); ordinal use starts at 250.
  const SEQ = ["#cde2fb", "#b7d3f6", "#9ec5f4", "#86b6ef", "#6da7ec", "#5598e7",
               "#3987e5", "#2a78d6", "#256abf", "#1c5cab", "#184f95", "#104281", "#0d366b"];
  const STATUS = { good: "#0ca30c", warning: "#fab219", serious: "#ec835a", critical: "#d03b3b", muted: "#898781", info: "#2a78d6" };

  /* Map a 0..1 magnitude onto the sequential ramp (ordinal floor at step 250). */
  function seqColor(v) {
    if (v === null || v === undefined) return "var(--grid)";
    const idx = 3 + Math.round(v * (SEQ.length - 4)); // start at step 250
    return SEQ[Math.max(3, Math.min(SEQ.length - 1, idx))];
  }

  /* ------------------------------------------------------- shared tooltip */
  let tipNode = null;
  function tip() {
    if (!tipNode) {
      tipNode = el("div", { class: "chart-tip", role: "status" });
      document.body.appendChild(tipNode);
    }
    return tipNode;
  }
  function bindTip(node, html) {
    node.addEventListener("mousemove", (e) => {
      const t = tip();
      t.innerHTML = html();
      t.style.display = "block";
      const pad = 14;
      const w = t.offsetWidth, h = t.offsetHeight;
      let x = e.clientX + pad, y = e.clientY + pad;
      if (x + w > window.innerWidth - 8) x = e.clientX - w - pad;
      if (y + h > window.innerHeight - 8) y = e.clientY - h - pad;
      t.style.left = `${x}px`; t.style.top = `${y}px`;
    });
    node.addEventListener("mouseleave", () => { tip().style.display = "none"; });
  }

  /* ----------------------------------------------------- readiness gauge */
  // Donut gauge: track + value arc in sequential blue; hero % centered;
  // the qualitative rating is a separate labeled status chip, not the arc color.
  function gauge(value /* 0-1 or null */, size = 168) {
    const stroke = 14;
    const r = (size - stroke) / 2;
    const c = 2 * Math.PI * r;
    const v = value === null ? 0 : Math.max(0, Math.min(1, value));
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
    svg.setAttribute("class", "gauge");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `Overall DCS readiness ${value === null ? "not yet assessed" : Math.round(v * 100) + " percent"}`);

    const track = document.createElementNS(svgNS, "circle");
    const arc = document.createElementNS(svgNS, "circle");
    [track, arc].forEach((n) => {
      n.setAttribute("cx", size / 2); n.setAttribute("cy", size / 2); n.setAttribute("r", r);
      n.setAttribute("fill", "none"); n.setAttribute("stroke-width", stroke);
    });
    track.setAttribute("stroke", "var(--grid)");
    arc.setAttribute("stroke", SEQ[7]);
    arc.setAttribute("stroke-linecap", "round");
    arc.setAttribute("stroke-dasharray", `${c * v * 0.999} ${c}`);
    arc.setAttribute("transform", `rotate(-90 ${size / 2} ${size / 2})`);
    svg.appendChild(track);
    if (value !== null) svg.appendChild(arc);

    const txt = document.createElementNS(svgNS, "text");
    txt.setAttribute("x", "50%"); txt.setAttribute("y", "50%");
    txt.setAttribute("text-anchor", "middle"); txt.setAttribute("dominant-baseline", "central");
    txt.setAttribute("class", "gauge-value");
    txt.textContent = value === null ? "—" : `${Math.round(v * 100)}%`;
    svg.appendChild(txt);
    return svg;
  }

  /* ------------------------------------------------------ domain heatmap */
  // One row per domain; cell fill = sequential ramp on avg score / 4.
  // Direct labels (score value) satisfy the contrast relief rule.
  function domainHeatmap(domainScores, onClickDomain) {
    const wrap = el("div", { class: "heatmap" });
    domainScores.forEach((d) => {
      const cell = el("button", {
        class: "heat-cell",
        style: `--cell:${seqColor(d.pct)}`,
        onclick: () => onClickDomain && onClickDomain(d.id),
        "aria-label": `${d.name}: ${d.avgScore === null ? "not scored" : "average score " + d.avgScore.toFixed(1) + " of 4"}`
      },
        el("span", { class: "heat-swatch" }),
        el("span", { class: "heat-name" }, d.short),
        el("span", { class: "heat-score" }, d.avgScore === null ? "–" : d.avgScore.toFixed(1))
      );
      bindTip(cell, () => `
        <strong>${UI.esc(d.name)}</strong><br>
        Average score: ${d.avgScore === null ? "not scored" : d.avgScore.toFixed(2) + " / 4"}<br>
        Scored: ${d.scoredCount} of ${d.applicable} applicable · Weight: ${d.weight}%<br>
        Evidence coverage: ${Math.round(d.evidencePct * 100)}%${d.failures ? `<br><span style="color:${STATUS.critical}">Failed items: ${d.failures}</span>` : ""}`);
      wrap.appendChild(cell);
    });
    return wrap;
  }

  /* ------------------------------------------------- horizontal bar rows */
  // Thin bars, rounded data-end, direct value labels; single measure → single hue.
  function barRows(rows /* {label, value(0-1|null), display, onclick} */) {
    const wrap = el("div", { class: "bar-rows" });
    rows.forEach((r) => {
      const v = r.value === null ? 0 : Math.max(0, Math.min(1, r.value));
      const row = el(r.onclick ? "button" : "div", {
        class: "bar-row", onclick: r.onclick,
        "aria-label": `${r.label}: ${r.display}`
      },
        el("span", { class: "bar-label" }, r.label),
        el("span", { class: "bar-track" },
          el("span", { class: "bar-fill", style: `width:${v * 100}%` })),
        el("span", { class: "bar-value" }, r.display));
      if (r.tip) bindTip(row, r.tip);
      wrap.appendChild(row);
    });
    return wrap;
  }

  /* ------------------------------------------------------------ stat tile */
  function statTile(label, value, opts = {}) {
    const t = el(opts.onclick ? "button" : "div",
      { class: `stat-tile${opts.tone ? " stat-" + opts.tone : ""}${opts.onclick ? " clickable" : ""}`, onclick: opts.onclick },
      el("div", { class: "stat-label" }, label),
      el("div", { class: "stat-value" }, String(value)),
      opts.sub ? el("div", { class: "stat-sub" }, opts.sub) : null);
    return t;
  }

  return { gauge, domainHeatmap, barRows, statTile, seqColor, STATUS, bindTip };
})();
