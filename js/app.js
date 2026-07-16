/* =========================================================================
 * DCS Assessment Command Center — App shell
 * Sidebar navigation, event switcher, theme handling, import/export wiring.
 * ========================================================================= */

"use strict";

const App = (() => {
  const { el } = UI;

  const NAV = [
    { id: "dashboard", label: "Dashboard",        icon: "◧", view: () => ViewDashboard },
    { id: "event",     label: "Event Workspace",  icon: "▤", view: () => ViewEvent },
    { id: "checklist", label: "DCS Checklist",    icon: "☑", view: () => ViewChecklist },
    { id: "testcards", label: "Test Cards",       icon: "▦", view: () => ViewTestCards },
    { id: "evidence",  label: "Evidence Locker",  icon: "◈", view: () => ViewEvidence },
    { id: "findings",  label: "Findings",         icon: "⚑", view: () => ViewFindings },
    { id: "reports",   label: "Report Builder",   icon: "≣", view: () => ViewReports, permission: "reports.view" },
    { id: "program",   label: "Program",          icon: "◔", view: () => ViewProgram, permission: "reports.view" },
    { id: "activity",  label: "Activity & Approvals", icon: "⌁", view: () => ViewActivity },
    { id: "administration", label: "Administration", icon: "⚙", view: () => ViewAdministration, anyPermission: ["users.manage", "assessment.team.manage"] }
  ];

  let current = "dashboard";

  function go(viewId, params = {}) {
    current = viewId;
    UI.closeDrawer();
    renderShell(params);
  }

  /* ------------------------------------------------------------- theming */
  function applyTheme() {
    const t = Store.getState().settings.theme || "auto";
    const dark = t === "dark" || (t === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  }
  function cycleTheme() {
    const order = ["auto", "light", "dark"];
    const st = Store.getState().settings;
    st.theme = order[(order.indexOf(st.theme || "auto") + 1) % order.length];
    Store.save();
    applyTheme();
    UI.toast(`Theme: ${st.theme}`);
  }

  /* ------------------------------------------------------- backup status */
  function backupNote() {
    const t = Store.getState().lastBackupAt;
    if (!t) return "No backup yet — download one before the event.";
    const days = Math.floor((Date.now() - new Date(t).getTime()) / 86400000);
    return days === 0 ? "Last backup: today" : `Last backup: ${days} day${days === 1 ? "" : "s"} ago`;
  }

  /* --------------------------------------------------------- event picker */
  function eventSwitcher() {
    const st = Store.getState();
    const ev = Store.activeEvent();
    const sel = UI.select(
      st.events.map((e) => ({ value: e.id, label: e.name + (e.isSample ? " •" : "") })),
      ev?.id || "", { class: "input event-select", title: "Switch assessment event", disabled: !ev });
    sel.addEventListener("change", () => { Store.setActiveEvent(sel.value); go("dashboard"); });
    return sel;
  }

  function newEventModal() {
    if (Auth.user().forcePasswordChange) return Auth.changePasswordModal(true);
    if (!Auth.globalPermissions().includes("assessment.create")) return UI.toast("Your system access does not allow creating assessments.", "error");
    const nameI = UI.input({ placeholder: "e.g., DCS/ZT Operational Demonstration FY27" });
    const locI = UI.input({ placeholder: "Location" });
    const winI = UI.input({ placeholder: "Event window (e.g., October 2026)" });
    const clsS = UI.select(DCS_TEMPLATE.CLASSIFICATIONS, "UNCLASSIFIED");
    UI.modal("Create New Assessment Event", el("div", {},
      el("p", { class: "card-hint" }, "A new event starts with a fresh, unscored copy of the 55-item DCS checklist template. To reuse a previous event's scope, threads, and test cards instead, use “Reuse as Template” from the event menu."),
      el("div", { class: "form-grid" },
        UI.field("Event Name", nameI),
        UI.field("Location", locI),
        UI.field("Event Window", winI),
        UI.field("Classification", clsS))), [
      { label: "Cancel", onclick: () => {} },
      { label: "Create Event", primary: true, onclick: () => {
          if (!nameI.value.trim()) { UI.toast("Event name is required.", "error"); return false; }
          Store.addEvent({ name: nameI.value.trim(), location: locI.value.trim(),
            eventWindow: winI.value.trim(), classification: clsS.value });
          UI.toast("Event created — start with the Event Workspace.");
          go("event");
        } }]);
  }

  function eventMenu() {
    const ev = Store.activeEvent();
    if (!ev) return newEventModal();
    UI.modal("Manage Events", el("div", {},
      el("p", { class: "card-hint" }, `Active event: ${ev.name}`),
      el("p", { class: "card-hint" }, `Your assessment role: ${String(Auth.assessmentAccess(ev.id).roleId || "system access").replaceAll("_", " ")}. All database changes are attributed to ${Auth.user().displayName}.`),
      el("div", { class: "export-grid" },
        Auth.globalPermissions().includes("assessment.create") ? el("button", { class: "btn btn-primary", onclick: () => { newEventModal(); } }, "+ New Event") : null,
        Auth.globalPermissions().includes("assessment.create") ? el("button", { class: "btn", onclick: () => {
            const copy = Store.duplicateEventAsTemplate(ev.id);
            UI.toast(`Created “${copy.name}” with a fresh checklist.`);
            go("event");
          } }, "Reuse as Template") : null,
        el("button", { class: "btn", onclick: () => Store.exportEventJSON(ev) }, "Export Event JSON"),
        Auth.globalPermissions().includes("assessment.create") ? el("button", { class: "btn", onclick: () => importFile() }, "Import JSON") : null,
        Auth.can("assessment.delete", ev.id) ? el("button", { class: "btn btn-danger", onclick: () => {
            UI.confirm("Delete event", `Delete “${ev.name}” and all of its data? This cannot be undone (export it first if unsure).`, () => {
              Store.deleteEvent(ev.id);
              UI.toast("Event deleted.");
              go("dashboard");
            });
          } }, "Archive Event") : null)), []);
  }

  function userMenu() {
    const user = Auth.user();
    const ev = Store.activeEvent();
    const role = ev ? String(Auth.assessmentAccess(ev.id).roleId || user.systemRole).replaceAll("_", " ") : user.systemRole.replaceAll("_", " ");
    UI.modal("Account & Session", el("div", { class: "profile-card" },
      el("div", { class: "avatar large" }, user.displayName.split(/\s+/).map((x) => x[0]).join("").slice(0, 2).toUpperCase()),
      el("div", {}, el("h3", {}, user.displayName), el("p", { class: "muted" }, `${user.username}${user.organization ? ` · ${user.organization}` : ""}`),
        el("p", {}, "Active assessment role: ", el("strong", {}, role)),
        el("div", { class: "row-actions" }, el("button", { class: "btn", onclick: () => Auth.changePasswordModal(false) }, "Change password"), el("button", { class: "btn btn-danger-ghost", onclick: Auth.logout }, "Sign out")))));
  }

  function importFile() {
    const fi = el("input", { type: "file", accept: ".json,application/json" });
    fi.addEventListener("change", () => {
      const f = fi.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const res = Store.importJSON(JSON.parse(reader.result));
          UI.toast(res.kind === "workspace" ? "Workspace restored from backup." : `Event “${res.name}” imported.`);
          go("dashboard");
        } catch (e) {
          UI.toast(e.message || "Import failed.", "error");
        }
      };
      reader.readAsText(f);
    });
    fi.click();
  }

  /* ---------------------------------------------------------------- shell */
  function renderShell(params = {}) {
    applyTheme();
    const ev = Store.activeEvent();
    const scores = ev ? Store.computeScores(ev) : null;
    const root = document.getElementById("app");
    root.innerHTML = "";

    const visibleNav = NAV.filter((n) => (!n.permission || Auth.can(n.permission)) && (!n.anyPermission || n.anyPermission.some((p) => Auth.can(p))));
    if (!visibleNav.some((n) => n.id === current)) current = visibleNav[0]?.id || "dashboard";
    document.body.classList.toggle("assessment-readonly", !!ev && !Auth.canWrite(ev.id));
    const nav = el("nav", { class: "sidebar" },
      el("div", { class: "brand" },
        el("div", { class: "brand-mark", "aria-hidden": "true" }, "DCS"),
        el("div", {},
          el("div", { class: "brand-name" }, "Assessment Command Center"),
          el("div", { class: "brand-sub" }, "Data-Centric Security Compliance"))),
      el("div", { class: "nav-list" }, visibleNav.map((n) =>
        el("button", { class: `nav-item${n.id === current ? " active" : ""}`, onclick: () => go(n.id) },
          el("span", { class: "nav-icon", "aria-hidden": "true" }, n.icon), n.label))),
      el("div", { class: "sidebar-foot" },
        el("div", { class: "workflow-hint" },
          el("strong", {}, "Workflow"),
          "Create event → define scope → add threads & assets → assign checklist → run test cards → attach evidence → score → findings → hotwash → report."),
        el("button", { class: "btn btn-ghost small", onclick: () => {
            Store.exportWorkspaceJSON();
            UI.toast("Workspace backup downloaded.");
            renderShell();
          }, title: "Download a JSON backup of every event" }, "⬇ Backup Workspace"),
        el("div", { class: "footer-note" }, backupNote()),
        el("div", { class: "sidebar-btn-row" },
          el("button", { class: "btn btn-ghost small", onclick: cycleTheme }, "Theme"),
          el("button", { class: "btn btn-ghost small", onclick: () => Assistant.configModal(),
            title: "Optional drafting help from a locally hosted model" },
            `✦ Local AI${Assistant.isEnabled() ? " ·on" : ""}`)),
        el("div", { class: "footer-note" }, `Database-backed · attributed as ${Auth.user().username}`)));

    const modeMeta = DCS_TEMPLATE.FRAMEWORK_MODES.find((m) => m.id === (ev && ev.frameworkMode || "combined")) || {};
    const statusNodes = ev ? [
      el("button", { class: "badge tone-info phase-chip", title: "Assessment phase — change it in Event Workspace → Event Profile", onclick: () => go("event") },
        ((DCS_TEMPLATE.PHASES.find((p) => p.id === ev.phase) || {}).label || "Phase not set")),
      el("button", { class: "badge tone-muted phase-chip", title: `Framework mode: ${modeMeta.label}. Change it in Event Workspace → Event Profile.`, onclick: () => go("event") },
        `Framework: ${modeMeta.short || "Combined"}`),
      el("span", { class: `class-banner class-${(ev.classification || "").startsWith("SECRET") ? "high" : "low"}` }, ev.classification || "UNCLASSIFIED"),
      el("span", { class: `rating-chip small tone-${scores.rating.tone}`, title: "Overall readiness (weighted, gated by critical failures)" },
        el("span", { class: "rating-dot", "aria-hidden": "true" }),
        scores.overallPct === null ? scores.rating.label : `${Math.round(scores.overallPct * 100)}% · ${scores.rating.label}`)
    ] : [];
    const topbar = el("header", { class: "topbar" },
      el("div", { class: "topbar-left" },
        eventSwitcher(),
        el("button", { class: "btn btn-ghost", onclick: eventMenu, title: "Manage events" }, ev ? "Events ▾" : "Create Assessment")),
      el("div", { class: "topbar-right" },
        statusNodes,
        el("button", { class: "user-chip", onclick: userMenu, title: "Account and sign out" }, el("span", { class: "avatar" }, Auth.user().displayName.split(/\s+/).map((x) => x[0]).join("").slice(0, 2).toUpperCase()), el("span", { class: "user-chip-text" }, Auth.user().displayName))));

    const main = el("main", { class: "main" });
    root.appendChild(nav);
    root.appendChild(el("div", { class: "content" }, topbar, main));

    if (!ev && !["administration"].includes(current)) {
      const canCreate = Auth.globalPermissions().includes("assessment.create") && !Auth.user().forcePasswordChange;
      main.appendChild(el("div", { class: "empty-workspace card" }, el("div", { class: "empty-icon" }, "◈"), el("h1", {}, "No assessment is assigned"),
        el("p", {}, Auth.user().forcePasswordChange ? "Change the temporary password to continue." : canCreate ? "Create the first assessment to initialize its 55-check DCS baseline and assign the assessment team." : "Ask an Assessment Lead or Program Manager to assign you to an assessment team."),
        canCreate ? el("button", { class: "btn btn-primary", onclick: newEventModal }, "+ Create Assessment") : null));
    } else {
      const navDef = visibleNav.find((n) => n.id === current) || visibleNav[0];
      navDef.view().render(main, params);
    }
  }

  /* ----------------------------------------------------------------- init */
  async function startAuthenticated() {
    await Store.load();
    applyTheme();
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") UI.closeDrawer();
    });
    renderShell();
    if (Auth.user().forcePasswordChange) setTimeout(() => Auth.changePasswordModal(true), 100);
  }

  async function init() {
    if (await Auth.init()) await startAuthenticated();
  }

  // Re-render the current view in place (used after remote sync updates).
  function refresh() { renderShell(); }

  return { init, startAuthenticated, go, refresh };
})();

document.addEventListener("DOMContentLoaded", App.init);
