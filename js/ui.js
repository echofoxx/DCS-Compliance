/* =========================================================================
 * DCS Assessment Command Center — UI helpers
 * DOM builders, badges, modal / drawer / toast primitives, form controls.
 * ========================================================================= */

"use strict";

const UI = (() => {

  /* ------------------------------------------------------------- builders */
  function el(tag, attrs = {}, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") node.className = v;
      else if (k === "html") node.innerHTML = v;
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else if (k === "value" && (tag === "input" || tag === "textarea" || tag === "select")) node.value = v;
      else if (k === "checked" || k === "selected" || k === "disabled" || k === "multiple") node[k] = !!v;
      else node.setAttribute(k, v);
    }
    for (const c of children.flat(Infinity)) {
      if (c === null || c === undefined || c === false) continue;
      node.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(c) : c);
    }
    return node;
  }

  const frag = (...children) => {
    const f = document.createDocumentFragment();
    children.flat(Infinity).forEach((c) => { if (c) f.appendChild(c); });
    return f;
  };

  const fmtDate = (iso) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return isNaN(d) ? iso : d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  const pct = (v) => (v === null || v === undefined) ? "—" : `${Math.round(v * 100)}%`;
  const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  /* --------------------------------------------------------------- badges */
  const SEVERITY_TONE = { critical: "critical", major: "serious", moderate: "warning", observation: "info", strength: "good" };
  const RESULT_TONE   = { pass: "good", partial: "warning", fail: "critical", no: "muted", na: "muted" };
  const WORKFLOW_TONE = { not_started: "muted", in_progress: "info", complete: "good", blocked: "critical" };
  const QUALITY_TONE  = { strong: "good", moderate: "warning", weak: "serious" };

  const label = (list, id) => (list.find((x) => x.id === id) || {}).label || "—";

  function badge(text, tone = "muted") {
    return el("span", { class: `badge tone-${tone}` }, text);
  }
  const severityBadge = (id) => id ? badge(label(DCS_TEMPLATE.SEVERITIES, id), SEVERITY_TONE[id] || "muted") : badge("—");
  const resultBadge   = (id) => id ? badge(label(DCS_TEMPLATE.RESULT_STATES, id), RESULT_TONE[id] || "muted") : badge("Unscored");
  const workflowBadge = (id) => badge(label(DCS_TEMPLATE.WORKFLOW_STATES, id), WORKFLOW_TONE[id] || "muted");
  const qualityBadge  = (id) => id ? badge(label(DCS_TEMPLATE.EVIDENCE_QUALITY, id), QUALITY_TONE[id] || "muted") : badge("—");

  function scorePill(score) {
    if (score === null || score === undefined) return el("span", { class: "score-pill score-none" }, "–");
    return el("span", { class: `score-pill score-${score}`, title: DCS_TEMPLATE.SCORE_RUBRIC[score].label }, String(score));
  }

  /* ---------------------------------------------------------------- toast */
  function toast(message, kind = "ok") {
    const root = document.getElementById("toast-root");
    const t = el("div", { class: `toast toast-${kind}` }, message);
    root.appendChild(t);
    requestAnimationFrame(() => t.classList.add("show"));
    setTimeout(() => { t.classList.remove("show"); setTimeout(() => t.remove(), 300); }, 3400);
  }

  /* ---------------------------------------------------------------- modal */
  function modal(title, bodyNode, actions = []) {
    const root = document.getElementById("modal-root");
    close(); // replace any modal already open
    const box = el("div", { class: "modal-box", role: "dialog", "aria-modal": "true", "aria-label": title },
      el("div", { class: "modal-head" },
        el("h2", {}, title),
        el("button", { class: "icon-btn", title: "Close", onclick: close }, "✕")),
      el("div", { class: "modal-body" }, bodyNode),
      actions.length ? el("div", { class: "modal-foot" },
        actions.map((a) => el("button", {
          class: a.primary ? "btn btn-primary" : (a.danger ? "btn btn-danger" : "btn"),
          onclick: () => { if (a.onclick() !== false) close(); }
        }, a.label))) : null
    );
    root.appendChild(el("div", { class: "modal-backdrop", onclick: (e) => { if (e.target.classList.contains("modal-backdrop")) close(); } }, box));
    root.classList.add("open");
    function close() { root.innerHTML = ""; root.classList.remove("open"); }
    return { close };
  }

  function confirm(title, message, onYes, yesLabel = "Delete") {
    modal(title, el("p", { class: "confirm-text" }, message), [
      { label: "Cancel", onclick: () => {} },
      { label: yesLabel, danger: true, onclick: onYes }
    ]);
  }

  /* --------------------------------------------------------------- drawer */
  function drawer(title, subtitle, bodyNode) {
    const root = document.getElementById("drawer-root");
    root.innerHTML = "";
    const box = el("aside", { class: "drawer", role: "dialog", "aria-label": title },
      el("div", { class: "drawer-head" },
        el("div", {},
          el("h2", {}, title),
          subtitle ? el("div", { class: "drawer-sub" }, subtitle) : null),
        el("button", { class: "icon-btn", title: "Close", onclick: closeDrawer }, "✕")),
      el("div", { class: "drawer-body" }, bodyNode));
    root.appendChild(box);
    root.classList.add("open");
    requestAnimationFrame(() => box.classList.add("show"));
  }
  function closeDrawer() {
    const root = document.getElementById("drawer-root");
    root.classList.remove("open");
    root.innerHTML = "";
  }

  /* ---------------------------------------------------------- form fields */
  function field(labelText, inputNode, hint) {
    return el("label", { class: "field" },
      el("span", { class: "field-label" }, labelText),
      inputNode,
      hint ? el("span", { class: "field-hint" }, hint) : null);
  }

  const input = (attrs = {}) => el("input", Object.assign({ class: "input", type: "text" }, attrs));
  const textarea = (attrs = {}) => el("textarea", Object.assign({ class: "input", rows: 3 }, attrs));

  function select(options, value, attrs = {}) {
    const s = el("select", Object.assign({ class: "input" }, attrs));
    options.forEach((o) => {
      const opt = typeof o === "string" ? { value: o, label: o } : o;
      s.appendChild(el("option", { value: opt.value, selected: opt.value === value }, opt.label));
    });
    return s;
  }

  /* multi-select as checkbox list (used for linking evidence, threads, items) */
  function checkList(options, selected, name) {
    const wrap = el("div", { class: "checklist-picker" });
    options.forEach((o) => {
      wrap.appendChild(el("label", { class: "check-row" },
        el("input", { type: "checkbox", name, value: o.value, checked: selected.includes(o.value) }),
        el("span", {}, o.label)));
    });
    if (!options.length) wrap.appendChild(el("div", { class: "empty-mini" }, "Nothing available yet."));
    return wrap;
  }
  const checkedValues = (container, name) =>
    [...container.querySelectorAll(`input[name="${name}"]:checked`)].map((i) => i.value);

  /* ------------------------------------------------------------ empty state */
  const empty = (title, hint) => el("div", { class: "empty-state" },
    el("div", { class: "empty-title" }, title),
    hint ? el("div", { class: "empty-hint" }, hint) : null);

  return {
    el, frag, fmtDate, pct, esc,
    badge, severityBadge, resultBadge, workflowBadge, qualityBadge, scorePill,
    toast, modal, confirm, drawer, closeDrawer,
    field, input, textarea, select, checkList, checkedValues, empty,
    SEVERITY_TONE, RESULT_TONE
  };
})();
