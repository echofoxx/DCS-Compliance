/* Immutable attribution/audit history and assessment review decisions. */
"use strict";

const ViewActivity = (() => {
  const { el } = UI;
  async function render(root) {
    const ev = Store.activeEvent();
    root.appendChild(el("div", { class: "view-head" }, el("div", {}, el("h1", {}, "Activity & Approvals"), el("p", { class: "view-sub" }, "Attribution, role assignments, review decisions, and tamper-evident change history for the active assessment.")),
      (Auth.can("assessment.review") || Auth.can("assessment.approve")) ? el("button", { class: "btn btn-primary", onclick: reviewModal }, "Record Review Decision") : null));
    if (!ev) return root.appendChild(UI.empty("No assessment selected", "Choose an assessment to view its activity."));
    const [reviews, audit] = await Promise.all([
      Auth.request(`/api/assessments/${ev.id}/reviews`),
      Auth.can("audit.view") ? Auth.request(`/api/audit?assessmentId=${encodeURIComponent(ev.id)}&limit=250`) : Promise.resolve({ entries: [] })
    ]);
    root.appendChild(reviewCard(reviews.reviews));
    if (Auth.can("audit.view")) root.appendChild(auditCard(audit.entries));
    else root.appendChild(el("div", { class: "callout" }, "Your role can see review decisions but not the detailed audit trail."));
  }
  function reviewCard(reviews) {
    return el("section", { class: "card" }, el("h2", { class: "card-title" }, "Review & Approval Record"),
      reviews.length ? el("div", { class: "timeline" }, reviews.map((r) => el("article", { class: "timeline-item" }, el("div", {}, UI.badge(String(r.decision).replaceAll("_", " "), r.decision === "approved" ? "good" : r.decision === "changes_requested" ? "warning" : "info"), el("strong", {}, ` ${r.reviewer_name}`), el("span", { class: "muted" }, ` · ${UI.fmtDate(r.created_at)}`)), r.comments ? el("p", {}, r.comments) : null))) : UI.empty("No review decisions", "Authorized reviewers can submit, request changes, approve, or reopen an assessment."));
  }
  function auditCard(entries) {
    const table = el("table", { class: "data-table" });
    table.appendChild(el("thead", {}, el("tr", {}, ["When", "Actor", "Action", "Changed records", "Integrity"].map((x) => el("th", {}, x)))));
    const rows = entries.map((a) => el("tr", {},
      el("td", {}, UI.fmtDate(a.created_at)),
      el("td", {}, el("strong", {}, a.actor_display_name), el("div", { class: "muted small" }, a.actor_username)),
      el("td", {}, a.action.replaceAll(".", " · ")),
      el("td", {}, (a.changed_paths || []).slice(0, 5).map((p) => el("div", { class: "code-path" }, p)), (a.changed_paths || []).length > 5 ? el("div", { class: "muted small" }, `+${a.changed_paths.length - 5} more`) : null),
      el("td", {}, el("span", { class: "hash", title: a.entry_hash }, String(a.entry_hash || "").slice(0, 12)))
    ));
    table.appendChild(el("tbody", {}, rows));
    return el("section", { class: "card" }, el("div", { class: "card-head" }, el("div", {}, el("h2", { class: "card-title" }, "Audit Trail"), el("p", { class: "card-hint" }, "Append-only records are cryptographically chained; evidence payload bytes are omitted from audit snapshots."))), el("div", { class: "table-wrap" }, table));
  }
  function reviewModal() {
    const ev = Store.activeEvent();
    const allowed = [
      ...(Auth.can("assessment.review") ? [{ value: "submitted", label: "Submit for review" }, { value: "changes_requested", label: "Request changes" }, { value: "reopened", label: "Reopen" }] : []),
      ...(Auth.can("assessment.approve") ? [{ value: "approved", label: "Approve" }] : [])
    ];
    const decision = UI.select(allowed, allowed[0]?.value); const comments = UI.textarea({ rows: 5 });
    UI.modal("Record review decision", el("div", { class: "form-stack" }, UI.field("Decision", decision), UI.field("Comments / conditions", comments, "State evidence gaps, conditions, or approval rationale.")), [{ label: "Cancel", onclick: () => {} }, { label: "Record decision", primary: true, onclick: () => Auth.request(`/api/assessments/${ev.id}/reviews`, { method: "POST", body: JSON.stringify({ decision: decision.value, comments: comments.value }) }).then(() => { UI.toast("Review decision recorded."); App.refresh(); }).catch((e) => UI.toast(e.message, "error")) }]);
  }
  return { render };
})();
