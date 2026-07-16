/* =========================================================================
 * DCS Assessment Command Center — Event Workspace view
 * Event profile, readiness meter, participants, systems, mission threads,
 * protected data objects, domain weights, and the daily execution log.
 * ========================================================================= */

"use strict";

const ViewEvent = (() => {
  const { el, field, input, textarea, select } = UI;

  let activeTab = "profile";

  const TABS = [
    { id: "profile",  label: "Event Profile" },
    { id: "scope",    label: "Assessment Scope" },
    { id: "threads",  label: "Mission Threads" },
    { id: "assets",   label: "Protected Data Objects" },
    { id: "people",   label: "Participants & Systems" },
    { id: "weights",  label: "Compliance Weights" },
    { id: "daily",    label: "Daily Log / Hotwash" }
  ];

  function render(container, params = {}) {
    if (params.tab) activeTab = params.tab;
    const ev = Store.activeEvent();
    container.innerHTML = "";

    const tabs = el("div", { class: "tab-bar" }, TABS.map((t) =>
      el("button", {
        class: `tab${t.id === activeTab ? " active" : ""}`,
        onclick: () => { activeTab = t.id; App.go("event"); }
      }, t.label)));

    const body = el("div", { class: "tab-body" });
    if (activeTab === "profile") body.appendChild(profileTab(ev));
    if (activeTab === "scope")   body.appendChild(scopeTab(ev));
    if (activeTab === "threads") body.appendChild(threadsTab(ev, params));
    if (activeTab === "assets")  body.appendChild(assetsTab(ev));
    if (activeTab === "people")  body.appendChild(peopleTab(ev));
    if (activeTab === "weights") body.appendChild(weightsTab(ev));
    if (activeTab === "daily")   body.appendChild(dailyTab(ev));

    container.appendChild(el("div", { class: "view" },
      el("div", { class: "view-head" },
        el("div", {},
          el("h1", {}, "Event Workspace"),
          el("p", { class: "view-sub" }, "Define scope, mission threads, protected assets, and participants before execution — the Readiness Meter tracks planning completeness.")),
        el("div", { class: "view-actions" },
          el("button", { class: "btn", onclick: () => Store.exportEventJSON(ev) }, "Export Event JSON"))),
      readinessMeter(ev), tabs, body));

    if (params.open && activeTab === "threads") {
      const mt = ev.missionThreads.find((m) => m.id === params.open);
      if (mt) openThread(ev, mt);
    }
  }

  /* -------------------------------------------------- event readiness meter */
  function readinessMeter(ev) {
    const checks = readinessChecks(ev);
    const done = checks.filter((c) => c.ok).length;
    return el("div", { class: "card readiness-meter" },
      el("div", { class: "rm-head" },
        el("h3", { class: "card-title" }, "Event Readiness Meter"),
        el("span", { class: `badge tone-${done === checks.length ? "good" : done >= 5 ? "warning" : "serious"}` },
          `${done} of ${checks.length} planning inputs complete`)),
      el("div", { class: "rm-grid" }, checks.map((c) =>
        el("button", { class: `rm-item ${c.ok ? "ok" : ""}`, title: c.ok ? "Done — click to review" : "Click to complete this step",
            onclick: c.go },
          el("span", { class: "rm-mark", "aria-hidden": "true" }, c.ok ? "✓" : "○"), c.label))));
  }

  // Shared with the dashboard's Getting Started guide — each check knows
  // where in the app it gets completed.
  function readinessChecks(ev) {
    return [
      { label: "Event profile complete", ok: !!(ev.name && ev.location && ev.eventWindow && ev.classification),
        go: () => App.go("event", { tab: "profile" }) },
      { label: "Objectives defined", ok: ev.objectives.length > 0,
        go: () => App.go("event", { tab: "profile" }) },
      { label: "Mission threads defined", ok: ev.missionThreads.length > 0,
        go: () => App.go("event", { tab: "threads" }) },
      { label: "Protected data objects registered", ok: ev.assets.length > 0,
        go: () => App.go("event", { tab: "assets" }) },
      { label: "Systems in scope listed", ok: ev.systems.length > 0,
        go: () => App.go("event", { tab: "people" }) },
      { label: "Assessors assigned", ok: ev.participants.length > 0,
        go: () => App.go("event", { tab: "people" }) },
      { label: "Checklist items assigned", ok: ev.checklist.some((c) => c.assignee),
        go: () => App.go("checklist") },
      { label: "Test cards created", ok: ev.testCards.length > 0,
        go: () => App.go("testcards") }
    ];
  }

  /* ------------------------------------------------------------ profile tab */
  function profileTab(ev) {
    const nameI = input({ value: ev.name });
    const phaseS = select(DCS_TEMPLATE.PHASES.map((p) => ({ value: p.id, label: p.label })), ev.phase || "planning");
    const modeS = select(DCS_TEMPLATE.FRAMEWORK_MODES.map((m) => ({ value: m.id, label: m.label })), ev.frameworkMode || "combined");
    const locI = input({ value: ev.location, placeholder: "e.g., Honolulu, HI" });
    const winI = input({ value: ev.eventWindow, placeholder: "e.g., October 2026 (on-site execution)" });
    const perI = input({ value: ev.assessmentPeriod, placeholder: "e.g., July – December 2026" });
    const clsS = select(DCS_TEMPLATE.CLASSIFICATIONS, ev.classification);
    const orgI = textarea({ value: ev.organizations.join("\n"), rows: 4, placeholder: "One organization per line" });
    const objI = textarea({ value: ev.objectives.join("\n"), rows: 5, placeholder: "One assessment objective per line" });
    const descI = textarea({ value: ev.description, rows: 3 });
    const stdWrap = UI.checkList(
      DCS_TEMPLATE.STANDARDS_OPTIONS.map((s) => ({ value: s, label: s })), ev.standards, "std");

    const saveBtn = el("button", {
      class: "btn btn-primary", onclick: () => {
        ev.name = nameI.value.trim() || ev.name;
        ev.phase = phaseS.value;
        const oldMode = ev.frameworkMode;
        ev.frameworkMode = modeS.value;
        // Auto-reconcile scope when switching modes: framework-driven scope
        // is derived on the fly by isInScope(), so no per-item mutation is
        // needed here. When switching *out* of Custom, clear any manual
        // out_of_scope markers that were only meaningful in Custom mode.
        if (oldMode === "custom" && ev.frameworkMode !== "custom") {
          ev.checklist.forEach((c) => {
            if (c.scope === "out_of_scope") { c.scope = "in_scope"; c.scopeReason = ""; }
          });
        }
        ev.location = locI.value.trim();
        ev.eventWindow = winI.value.trim();
        ev.assessmentPeriod = perI.value.trim();
        ev.classification = clsS.value;
        ev.description = descI.value.trim();
        ev.organizations = orgI.value.split("\n").map((s) => s.trim()).filter(Boolean);
        ev.objectives = objI.value.split("\n").map((s) => s.trim()).filter(Boolean);
        ev.standards = UI.checkedValues(stdWrap, "std");
        Store.save();
        UI.toast("Event profile saved.");
        App.go("event", { tab: "profile" }); // refresh topbar phase/classification chips
      }
    }, "Save Profile");

    return el("div", { class: "card form-card" },
      el("div", { class: "form-grid" },
        field("Event Name", nameI),
        field("Assessment Phase", phaseS,
          (DCS_TEMPLATE.PHASES.find((p) => p.id === (ev.phase || "planning")) || {}).hint),
        field("Framework Mode", modeS,
          (DCS_TEMPLATE.FRAMEWORK_MODES.find((m) => m.id === (ev.frameworkMode || "combined")) || {}).hint),
        field("Location", locI),
        field("Event Window", winI),
        field("Assessment Period", perI),
        field("Classification Level", clsS, "Governs handling of everything captured in this event."),
        field("Description", descI)),
      el("div", { class: "form-grid" },
        field("Participating Organizations", orgI),
        field("Assessment Objectives", objI)),
      field("Standards Alignment", stdWrap),
      el("div", { class: "form-foot" }, saveBtn));
  }

  /* ------------------------------------------------------ mission threads */
  function threadsTab(ev, params) {
    const wrap = el("div", {});
    wrap.appendChild(el("div", { class: "list-toolbar" },
      el("p", { class: "card-hint" },
        "Mission threads tie every checklist item and test card to an operational outcome — this is what keeps the assessment from becoming a generic cyber checklist."),
      el("button", { class: "btn btn-primary", onclick: () => editThread(ev, null) }, "+ Add Mission Thread")));

    if (!ev.missionThreads.length) {
      wrap.appendChild(UI.empty("No mission threads yet", "Example: “Coalition operational data sharing — partner sees authorized information only.”"));
      return wrap;
    }

    const table = el("table", { class: "data-table" },
      el("thead", {}, el("tr", {},
        ["Mission Thread", "Operational User", "Partner User", "DCS Action", "Tests", "Status", ""].map((h) => el("th", {}, h)))),
      el("tbody", {}, ev.missionThreads.map((mt) => {
        const tests = ev.testCards.filter((t) => t.missionThreadId === mt.id);
        const run = tests.filter((t) => t.result);
        const failed = run.filter((t) => t.result === "fail").length;
        return el("tr", { class: "clickable", onclick: () => openThread(ev, mt) },
          el("td", {}, el("strong", {}, mt.name)),
          el("td", {}, mt.operationalUser || "—"),
          el("td", {}, mt.partnerUser || "—"),
          el("td", {}, mt.dcsAction || "—"),
          el("td", {}, UI.badge(`${run.length}/${tests.length}`, failed ? "critical" : run.length ? "good" : "muted")),
          el("td", {}, UI.workflowBadge(mt.status || "not_started")),
          el("td", { onclick: (e) => e.stopPropagation() },
            el("button", { class: "icon-btn", title: "Edit", onclick: () => editThread(ev, mt) }, "✎"),
            el("button", { class: "icon-btn danger", title: "Delete", onclick: () =>
              UI.confirm("Delete mission thread", `Delete “${mt.name}”? Links from checklist items and test cards will be removed.`, () => {
                ev.missionThreads = ev.missionThreads.filter((m) => m.id !== mt.id);
                ev.checklist.forEach((c) => { c.missionThreadIds = c.missionThreadIds.filter((x) => x !== mt.id); });
                ev.testCards.forEach((t) => { if (t.missionThreadId === mt.id) t.missionThreadId = ""; });
                Store.save(); App.go("event");
              }) }, "🗑")));
      })));
    wrap.appendChild(el("div", { class: "card table-card" }, table));
    return wrap;
  }

  function openThread(ev, mt) {
    const tests = ev.testCards.filter((t) => t.missionThreadId === mt.id);
    const items = ev.checklist.filter((c) => c.missionThreadIds.includes(mt.id));
    const findings = ev.findings.filter((f) => f.missionThreadId === mt.id);
    UI.drawer(mt.name, "Mission Thread", el("div", {},
      el("dl", { class: "detail-list" },
        el("dt", {}, "Operational User"), el("dd", {}, mt.operationalUser || "—"),
        el("dt", {}, "Partner User"), el("dd", {}, mt.partnerUser || "—"),
        el("dt", {}, "Protected Assets"), el("dd", {},
          mt.assetIds.map((id) => (ev.assets.find((a) => a.id === id) || {}).name).filter(Boolean).join(", ") || "—"),
        el("dt", {}, "DCS Action"), el("dd", {}, mt.dcsAction || "—"),
        el("dt", {}, "Expected Outcome"), el("dd", {}, mt.expectedOutcome || "—"),
        el("dt", {}, "Notes"), el("dd", {}, mt.notes || "—")),
      el("h4", { class: "drawer-h" }, `Linked Test Cards (${tests.length})`),
      tests.length ? el("ul", { class: "mini-list" }, tests.map((t) =>
        el("li", { class: "mini-row clickable", onclick: () => { UI.closeDrawer(); App.go("testcards", { open: t.id }); } },
          UI.resultBadge(t.result), el("span", { class: "mini-title" }, t.title)))) : el("p", { class: "empty-mini" }, "None yet."),
      el("h4", { class: "drawer-h" }, `Linked Checklist Items (${items.length})`),
      items.length ? el("ul", { class: "mini-list" }, items.map((c) =>
        el("li", { class: "mini-row clickable", onclick: () => { UI.closeDrawer(); App.go("checklist", { open: c.id }); } },
          UI.scorePill(c.score), el("span", { class: "mini-id" }, c.id),
          el("span", { class: "mini-title" }, Store.templateItem(c.id).requirement)))) : el("p", { class: "empty-mini" }, "None yet."),
      el("h4", { class: "drawer-h" }, `Findings (${findings.length})`),
      findings.length ? el("ul", { class: "mini-list" }, findings.map((f) =>
        el("li", { class: "mini-row clickable", onclick: () => { UI.closeDrawer(); App.go("findings", { open: f.id }); } },
          UI.severityBadge(f.severity), el("span", { class: "mini-title" }, f.title)))) : el("p", { class: "empty-mini" }, "None yet."),
      el("div", { class: "drawer-actions" },
        el("button", { class: "btn", onclick: () => { UI.closeDrawer(); editThread(ev, mt); } }, "Edit Thread"))));
  }

  function editThread(ev, mt) {
    const isNew = !mt;
    const data = mt || { id: Store.uid("MT"), name: "", operationalUser: "", partnerUser: "",
      assetIds: [], dcsAction: "", expectedOutcome: "", notes: "", status: "not_started" };
    const nameI = input({ value: data.name, placeholder: "e.g., Coalition operational data sharing" });
    const ouI = input({ value: data.operationalUser, placeholder: "e.g., U.S. watch officer" });
    const puI = input({ value: data.partnerUser, placeholder: "e.g., Coalition mission partner" });
    const actI = input({ value: data.dcsAction, placeholder: "e.g., Allow releasable subset, deny restricted fields" });
    const outI = input({ value: data.expectedOutcome, placeholder: "e.g., Partner sees authorized information only" });
    const stS = select(DCS_TEMPLATE.WORKFLOW_STATES.map((w) => ({ value: w.id, label: w.label })), data.status);
    const notesI = textarea({ value: data.notes });
    const assetPick = UI.checkList(ev.assets.map((a) => ({ value: a.id, label: a.name })), data.assetIds, "mt-assets");

    UI.modal(isNew ? "Add Mission Thread" : "Edit Mission Thread", el("div", { class: "form-grid" },
      field("Mission Thread Name", nameI),
      field("Operational User", ouI),
      field("Partner User", puI),
      field("DCS Action", actI),
      field("Expected Outcome", outI),
      field("Status", stS),
      field("Protected Assets", assetPick),
      field("Notes", notesI)), [
      { label: "Cancel", onclick: () => {} },
      { label: isNew ? "Add Thread" : "Save", primary: true, onclick: () => {
          if (!nameI.value.trim()) { UI.toast("Name is required.", "error"); return false; }
          Object.assign(data, {
            name: nameI.value.trim(), operationalUser: ouI.value.trim(), partnerUser: puI.value.trim(),
            dcsAction: actI.value.trim(), expectedOutcome: outI.value.trim(), status: stS.value,
            notes: notesI.value.trim(), assetIds: UI.checkedValues(assetPick.parentNode, "mt-assets")
          });
          if (isNew) ev.missionThreads.push(data);
          Store.save(); App.go("event");
        } }]);
  }

  /* ------------------------------------------------------- CSV import */
  const CSV_SPECS = {
    participants: {
      label: "participants",
      headers: ["name", "organization", "role", "email"],
      example: ["A. Ramirez", "JS J6", "Assessment Lead", "a.ramirez@example.mil"],
      toRecord: (r) => ({
        id: Store.uid("P"), name: r.name || "",
        org: r.organization || r.org || "",
        role: DCS_TEMPLATE.APP_ROLES.includes(r.role) ? r.role : (r.role || DCS_TEMPLATE.APP_ROLES[1]),
        email: r.email || ""
      }),
      push: (ev, rec) => ev.participants.push(rec)
    },
    assets: {
      label: "protected data objects",
      headers: ["name", "type", "owner", "steward", "source_system", "classification",
        "releasability", "caveats", "mission_tags", "protections", "risk_rating", "notes"],
      example: ["COP Feed", "Data feed / API", "J3 Operations", "J. Whitfield", "Mission Data Platform",
        "CUI", "REL TO USA, Coalition (subset)", "Restricted fields: sensor source", "COP",
        "Field-level redaction; Encryption in transit", "High", ""],
      toRecord: (r) => ({
        id: Store.uid("AST"), name: r.name || "", type: r.type || "",
        owner: r.owner || "", steward: r.steward || "",
        sourceSystem: r.source_system || "", classification: r.classification || "UNCLASSIFIED",
        releasability: r.releasability || "", caveats: r.caveats || "",
        missionTags: r.mission_tags || "",
        protections: (r.protections || "").split(";").map((s) => s.trim()).filter(Boolean),
        riskRating: ["High", "Moderate", "Low"].includes(r.risk_rating) ? r.risk_rating : (r.risk_rating || "Moderate"),
        notes: r.notes || ""
      }),
      push: (ev, rec) => ev.assets.push(rec)
    }
  };

  function csvTemplate(kind) {
    const spec = CSV_SPECS[kind];
    Store.download(`dcs-${kind}-template.csv`,
      spec.headers.join(",") + "\r\n" + spec.example.map((v) => /[",]/.test(v) ? `"${v}"` : v).join(",") + "\r\n",
      "text/csv");
  }

  function importCSV(ev, kind) {
    const spec = CSV_SPECS[kind];
    const fi = el("input", { type: "file", accept: ".csv,text/csv" });
    fi.addEventListener("change", () => {
      const f = fi.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const rows = Store.parseCSV(String(reader.result));
          if (!rows.length) { UI.toast("No data rows found. Use the CSV template for the expected columns.", "error"); return; }
          let added = 0, skipped = 0;
          rows.forEach((r) => {
            const rec = spec.toRecord(r);
            if (!rec.name) { skipped++; return; }
            spec.push(ev, rec); added++;
          });
          Store.save();
          UI.toast(`Imported ${added} ${spec.label}${skipped ? ` (${skipped} skipped — missing name)` : ""}.`);
          App.go("event");
        } catch (err) {
          UI.toast("Import failed: " + err.message, "error");
        }
      };
      reader.readAsText(f);
    });
    fi.click();
  }

  /* --------------------------------------------------- protected assets */
  function assetsTab(ev) {
    const wrap = el("div", {});
    wrap.appendChild(el("div", { class: "list-toolbar" },
      el("p", { class: "card-hint" }, "The protected data object register: what is being protected, who owns it, how it is labeled, and what protections it requires."),
      el("div", { class: "toolbar-btns" },
        el("button", { class: "btn", title: "Download the column template", onclick: () => csvTemplate("assets") }, "CSV Template"),
        el("button", { class: "btn", onclick: () => importCSV(ev, "assets") }, "Import CSV"),
        el("button", { class: "btn btn-primary", onclick: () => editAsset(ev, null) }, "+ Register Data Object"))));

    if (!ev.assets.length) {
      wrap.appendChild(UI.empty("No protected data objects registered", "Register datasets, APIs, files, feeds, messages, or data products protected by DCS controls."));
      return wrap;
    }

    const table = el("table", { class: "data-table" },
      el("thead", {}, el("tr", {},
        ["Asset", "Type", "Owner / Steward", "Classification", "Releasability", "Risk", ""].map((h) => el("th", {}, h)))),
      el("tbody", {}, ev.assets.map((a) =>
        el("tr", { class: "clickable", onclick: () => openAsset(ev, a) },
          el("td", {}, el("strong", {}, a.name)),
          el("td", {}, a.type || "—"),
          el("td", {}, `${a.owner || "—"} / ${a.steward || "—"}`),
          el("td", {}, UI.badge(a.classification || "—", "info")),
          el("td", {}, a.releasability || "—"),
          el("td", {}, UI.badge(a.riskRating || "—", { High: "critical", Moderate: "warning", Low: "good" }[a.riskRating] || "muted")),
          el("td", { onclick: (e) => e.stopPropagation() },
            el("button", { class: "icon-btn", title: "Edit", onclick: () => editAsset(ev, a) }, "✎"),
            el("button", { class: "icon-btn danger", title: "Delete", onclick: () =>
              UI.confirm("Delete data object", `Delete “${a.name}”?`, () => {
                ev.assets = ev.assets.filter((x) => x.id !== a.id);
                ev.missionThreads.forEach((mt) => { mt.assetIds = mt.assetIds.filter((x) => x !== a.id); });
                ev.testCards.forEach((t) => { if (t.assetId === a.id) t.assetId = ""; });
                Store.save(); App.go("event");
              }) }, "🗑"))))));
    wrap.appendChild(el("div", { class: "card table-card" }, table));
    return wrap;
  }

  function openAsset(ev, a) {
    const threads = ev.missionThreads.filter((mt) => mt.assetIds.includes(a.id));
    UI.drawer(a.name, "Protected Data Object", el("div", {},
      el("dl", { class: "detail-list" },
        el("dt", {}, "Type"), el("dd", {}, a.type || "—"),
        el("dt", {}, "Owner"), el("dd", {}, a.owner || "—"),
        el("dt", {}, "Steward"), el("dd", {}, a.steward || "—"),
        el("dt", {}, "Source System"), el("dd", {}, a.sourceSystem || "—"),
        el("dt", {}, "Classification"), el("dd", {}, a.classification || "—"),
        el("dt", {}, "Releasability"), el("dd", {}, a.releasability || "—"),
        el("dt", {}, "Handling Caveats"), el("dd", {}, a.caveats || "—"),
        el("dt", {}, "Mission Tags"), el("dd", {}, a.missionTags || "—"),
        el("dt", {}, "Required Protections"), el("dd", {}, (a.protections || []).join(", ") || "—"),
        el("dt", {}, "Risk Rating"), el("dd", {}, a.riskRating || "—"),
        el("dt", {}, "Notes"), el("dd", {}, a.notes || "—")),
      el("h4", { class: "drawer-h" }, `Mission Threads Using This Asset (${threads.length})`),
      threads.length ? el("ul", { class: "mini-list" }, threads.map((mt) =>
        el("li", { class: "mini-row clickable", onclick: () => openThread(ev, mt) },
          el("span", { class: "mini-title" }, mt.name)))) : el("p", { class: "empty-mini" }, "Not linked to a mission thread yet."),
      el("div", { class: "drawer-actions" },
        el("button", { class: "btn", onclick: () => { UI.closeDrawer(); editAsset(ev, a); } }, "Edit"))));
  }

  function editAsset(ev, a) {
    const isNew = !a;
    const data = a || { id: Store.uid("AST"), name: "", type: "", owner: "", steward: "", sourceSystem: "",
      classification: "UNCLASSIFIED", releasability: "", caveats: "", missionTags: "", protections: [], riskRating: "Moderate", notes: "" };
    const nameI = input({ value: data.name });
    const typeI = input({ value: data.type, placeholder: "Dataset, API, file, feed, message, data product…" });
    const ownI = input({ value: data.owner });
    const stwI = input({ value: data.steward });
    const srcI = input({ value: data.sourceSystem });
    const clsS = select(DCS_TEMPLATE.CLASSIFICATIONS, data.classification);
    const relI = input({ value: data.releasability, placeholder: "e.g., REL TO USA, Coalition Partners (subset)" });
    const cavI = input({ value: data.caveats });
    const tagI = input({ value: data.missionTags });
    const protI = textarea({ value: (data.protections || []).join("\n"), rows: 3, placeholder: "One protection per line (encryption, redaction, DLP…)" });
    const riskS = select(["High", "Moderate", "Low"], data.riskRating);
    const notesI = textarea({ value: data.notes });

    UI.modal(isNew ? "Register Protected Data Object" : "Edit Protected Data Object",
      el("div", { class: "form-grid" },
        field("Name", nameI), field("Type", typeI),
        field("Owner", ownI), field("Data Steward", stwI),
        field("Source System", srcI), field("Classification", clsS),
        field("Releasability", relI), field("Handling Caveats", cavI),
        field("Mission Tags", tagI), field("Risk Rating", riskS),
        field("Required Protections", protI), field("Notes", notesI)), [
      { label: "Cancel", onclick: () => {} },
      { label: isNew ? "Register" : "Save", primary: true, onclick: () => {
          if (!nameI.value.trim()) { UI.toast("Name is required.", "error"); return false; }
          Object.assign(data, {
            name: nameI.value.trim(), type: typeI.value.trim(), owner: ownI.value.trim(),
            steward: stwI.value.trim(), sourceSystem: srcI.value.trim(), classification: clsS.value,
            releasability: relI.value.trim(), caveats: cavI.value.trim(), missionTags: tagI.value.trim(),
            protections: protI.value.split("\n").map((s) => s.trim()).filter(Boolean),
            riskRating: riskS.value, notes: notesI.value.trim()
          });
          if (isNew) ev.assets.push(data);
          Store.save(); App.go("event");
        } }]);
  }

  /* ------------------------------------------- participants & systems */
  function peopleTab(ev) {
    const wrap = el("div", { class: "two-col" });

    const pCard = el("div", { class: "card" },
      el("div", { class: "list-toolbar" },
        el("h3", { class: "card-title" }, "Participants & Assessors"),
        el("div", { class: "toolbar-btns" },
          el("button", { class: "btn small", title: "Download the column template", onclick: () => csvTemplate("participants") }, "CSV Template"),
          el("button", { class: "btn small", onclick: () => importCSV(ev, "participants") }, "Import CSV"),
          el("button", { class: "btn small", onclick: () => editPerson(ev, null) }, "+ Add"))),
      ev.participants.length
        ? el("table", { class: "data-table" },
            el("thead", {}, el("tr", {}, ["Name", "Organization", "Role", ""].map((h) => el("th", {}, h)))),
            el("tbody", {}, ev.participants.map((p) =>
              el("tr", {},
                el("td", {}, p.name), el("td", {}, p.org || "—"),
                el("td", {}, UI.badge(p.role, "info")),
                el("td", {},
                  el("button", { class: "icon-btn", title: "Edit", onclick: () => editPerson(ev, p) }, "✎"),
                  el("button", { class: "icon-btn danger", title: "Remove", onclick: () =>
                    UI.confirm("Remove participant", `Remove ${p.name}?`, () => {
                      ev.participants = ev.participants.filter((x) => x.id !== p.id);
                      Store.save(); App.go("event");
                    }) }, "🗑"))))))
        : UI.empty("No participants", "Add assessors, stewards, SMEs, and leadership viewers."));

    const sCard = el("div", { class: "card" },
      el("div", { class: "list-toolbar" },
        el("h3", { class: "card-title" }, "Systems in Scope"),
        el("button", { class: "btn", onclick: () => editSystem(ev, null) }, "+ Add")),
      ev.systems.length
        ? el("table", { class: "data-table" },
            el("thead", {}, el("tr", {}, ["System", "Layer", "Owner", ""].map((h) => el("th", {}, h)))),
            el("tbody", {}, ev.systems.map((s) =>
              el("tr", {},
                el("td", {}, el("strong", {}, s.name), s.notes ? el("div", { class: "cell-sub" }, s.notes) : null),
                el("td", {}, s.layer || "—"), el("td", {}, s.owner || "—"),
                el("td", {},
                  el("button", { class: "icon-btn", title: "Edit", onclick: () => editSystem(ev, s) }, "✎"),
                  el("button", { class: "icon-btn danger", title: "Remove", onclick: () =>
                    UI.confirm("Remove system", `Remove ${s.name}?`, () => {
                      ev.systems = ev.systems.filter((x) => x.id !== s.id);
                      Store.save(); App.go("event");
                    }) }, "🗑"))))))
        : UI.empty("No systems listed", "List PDPs, PEPs, gateways, data platforms, identity and telemetry systems."));

    wrap.appendChild(pCard);
    wrap.appendChild(sCard);
    return wrap;
  }

  function editPerson(ev, p) {
    const isNew = !p;
    const data = p || { id: Store.uid("P"), name: "", org: "", role: DCS_TEMPLATE.APP_ROLES[1], email: "" };
    const nameI = input({ value: data.name });
    const orgI = input({ value: data.org });
    const roleS = select(DCS_TEMPLATE.APP_ROLES, data.role);
    const emailI = input({ value: data.email, type: "email" });
    UI.modal(isNew ? "Add Participant" : "Edit Participant", el("div", { class: "form-grid" },
      field("Name", nameI), field("Organization", orgI), field("Role", roleS), field("Email", emailI)), [
      { label: "Cancel", onclick: () => {} },
      { label: isNew ? "Add" : "Save", primary: true, onclick: () => {
          if (!nameI.value.trim()) { UI.toast("Name is required.", "error"); return false; }
          Object.assign(data, { name: nameI.value.trim(), org: orgI.value.trim(), role: roleS.value, email: emailI.value.trim() });
          if (isNew) ev.participants.push(data);
          Store.save(); App.go("event");
        } }]);
  }

  function editSystem(ev, s) {
    const isNew = !s;
    const data = s || { id: Store.uid("SYS"), name: "", layer: "", owner: "", notes: "" };
    const nameI = input({ value: data.name });
    const layerI = input({ value: data.layer, placeholder: "Application / API / Gateway / Platform / Endpoint…" });
    const ownI = input({ value: data.owner });
    const notesI = textarea({ value: data.notes });
    UI.modal(isNew ? "Add System" : "Edit System", el("div", { class: "form-grid" },
      field("System Name", nameI), field("Enforcement / Control Layer", layerI),
      field("Owner", ownI), field("Notes", notesI)), [
      { label: "Cancel", onclick: () => {} },
      { label: isNew ? "Add" : "Save", primary: true, onclick: () => {
          if (!nameI.value.trim()) { UI.toast("Name is required.", "error"); return false; }
          Object.assign(data, { name: nameI.value.trim(), layer: layerI.value.trim(), owner: ownI.value.trim(), notes: notesI.value.trim() });
          if (isNew) ev.systems.push(data);
          Store.save(); App.go("event");
        } }]);
  }

  /* ---------------------------------------------------- domain weights */
  /* ---------------------------------------------------- assessment scope */
  function scopeTab(ev) {
    const mode = ev.frameworkMode || "combined";
    const modeMeta = DCS_TEMPLATE.FRAMEWORK_MODES.find((m) => m.id === mode) || {};
    const isCustom = mode === "custom";
    const scores = Store.computeScores(ev);

    const wrap = el("div", {});

    wrap.appendChild(el("div", { class: "card" },
      el("h3", { class: "card-title" }, "Framework Mode"),
      el("p", { class: "card-hint" },
        `Currently: ${modeMeta.label}. ${modeMeta.hint} Change it in the Event Profile tab.`),
      el("div", { class: "audit-stats" },
        el("span", { class: "audit-chip" }, el("span", { class: "audit-chip-label" }, "In scope"), String(scores.inScopeCount)),
        el("span", { class: "audit-chip" }, el("span", { class: "audit-chip-label" }, "Out of scope"), String(scores.outOfScopeCount)),
        el("span", { class: "audit-chip" }, el("span", { class: "audit-chip-label" }, "Framework"), modeMeta.short || mode))));

    /* Custom scope note — the "why" that lands in the report */
    if (isCustom) {
      const noteI = textarea({ value: ev.customScopeNote || "", rows: 3,
        placeholder: "Explain the rationale for this custom scope: which mission threads or domains this event covers, and what is deliberately out of scope. Included verbatim in the report's Assessment Scope Statement." });
      const saveNote = el("button", { class: "btn btn-primary", onclick: () => {
          ev.customScopeNote = noteI.value.trim(); Store.save();
          UI.toast("Scope rationale saved.");
        } }, "Save Rationale");
      wrap.appendChild(el("div", { class: "card" },
        el("h3", { class: "card-title" }, "Custom Scope Rationale"),
        el("p", { class: "card-hint" }, "Required for Custom mode — appears in the final report's Assessment Scope Statement."),
        field("Rationale", noteI), el("div", { class: "form-foot" }, saveNote)));
    }

    /* Bulk scope by domain */
    const bulkCard = el("div", { class: "card" },
      el("h3", { class: "card-title" }, "Bulk Scope by Domain"),
      el("p", { class: "card-hint" }, "Turn a whole DCS domain off (or back on) for this assessment. In-scope items are counted toward the readiness score; out-of-scope items are hidden and never trip the critical gate."));

    const domainRows = DCS_TEMPLATE.DOMAINS.map((d) => {
      const items = ev.checklist.filter((c) => Store.templateItem(c.id).domainId === d.id);
      const inScopeCount = items.filter((c) => (c.scope || "in_scope") === "in_scope").length;
      const allIn = inScopeCount === items.length;
      const allOut = inScopeCount === 0;
      const state = allIn ? "in" : allOut ? "out" : "mixed";
      const stateBadge = state === "in"
        ? UI.badge(`${inScopeCount}/${items.length} in scope`, "good")
        : state === "out"
          ? UI.badge("all out of scope", "muted")
          : UI.badge(`${inScopeCount}/${items.length} in scope`, "warning");
      const btn = el("button", { class: "btn small", onclick: () => bulkSetDomainScope(ev, d, state === "out" ? "in_scope" : "out_of_scope") },
        state === "out" ? "Include" : "Exclude");
      return el("tr", {},
        el("td", {}, el("strong", {}, d.code), " ", d.name,
          el("div", { class: "cell-sub" }, d.focus)),
        el("td", {}, stateBadge),
        el("td", {}, btn));
    });
    bulkCard.appendChild(el("table", { class: "data-table compact" },
      el("thead", {}, el("tr", {}, ["DCS Domain", "Scope Status", ""].map((h) => el("th", {}, h)))),
      el("tbody", {}, domainRows)));
    wrap.appendChild(bulkCard);

    /* Per-item scope list — jump straight to any item to change its scope */
    if (scores.outOfScopeCount) {
      const outItems = ev.checklist.filter((c) => (c.scope || "in_scope") !== "in_scope"
        || !Store.itemInFrameworkMode(c.id, mode));
      wrap.appendChild(el("div", { class: "card" },
        el("h3", { class: "card-title" }, `Excluded Items (${outItems.length})`),
        el("p", { class: "card-hint" }, "Items excluded by domain, by framework mode, or individually. Click any item to review or restore it."),
        el("ul", { class: "mini-list" }, outItems.slice(0, 40).map((c) => {
          const t = Store.templateItem(c.id);
          const reason = c.scope && c.scope !== "in_scope"
            ? (c.scopeReason || "no reason recorded")
            : `Excluded by framework mode (${modeMeta.short || mode})`;
          return el("li", { class: "mini-row clickable", onclick: () => App.go("checklist", { open: c.id }) },
            UI.badge(t.domainId, "muted"),
            el("span", { class: "mini-id" }, c.id),
            el("span", { class: "mini-title" }, t.requirement),
            el("span", { class: "mini-meta" }, reason));
        }))));
    }

    return wrap;
  }

  function bulkSetDomainScope(ev, domain, target) {
    const items = ev.checklist.filter((c) => Store.templateItem(c.id).domainId === domain.id);
    if (target === "out_of_scope") {
      const reasonI = textarea({ rows: 2,
        placeholder: `Why is the ${domain.name} domain out of scope for this assessment? Recorded in the report.` });
      UI.modal(`Exclude "${domain.name}" from this assessment`, el("div", {},
        el("p", { class: "card-hint" }, `${items.length} checklist item(s) in this domain will be excluded from scoring and the critical gate. Add a rationale for the report.`),
        field("Reason", reasonI)), [
        { label: "Cancel", onclick: () => {} },
        { label: "Exclude Domain", primary: true, onclick: () => {
            if (!reasonI.value.trim()) { UI.toast("A reason is required for scope changes.", "error"); return false; }
            items.forEach((c) => { c.scope = "out_of_scope"; c.scopeReason = reasonI.value.trim(); });
            Store.save(); UI.toast(`Excluded ${items.length} item(s).`);
            App.go("event", { tab: "scope" });
          } }]);
    } else {
      items.forEach((c) => { c.scope = "in_scope"; c.scopeReason = ""; });
      Store.save(); UI.toast(`Restored ${items.length} item(s) to scope.`);
      App.go("event", { tab: "scope" });
    }
  }

  function weightsTab(ev) {
    const inputs = {};
    const rows = DCS_TEMPLATE.DOMAINS.map((d) => {
      const w = input({ type: "number", min: 0, max: 100, value: ev.domainWeights[d.id] ?? d.weight, class: "input weight-input" });
      inputs[d.id] = w;
      return el("tr", {},
        el("td", {}, el("strong", {}, d.name), el("div", { class: "cell-sub" }, d.focus)),
        el("td", {}, w));
    });
    const totalCell = el("td", { class: "weight-total" });
    const updateTotal = () => {
      const total = Object.values(inputs).reduce((s, i) => s + (parseFloat(i.value) || 0), 0);
      totalCell.textContent = `${total}%`;
      totalCell.className = `weight-total ${total === 100 ? "ok" : "bad"}`;
    };
    Object.values(inputs).forEach((i) => i.addEventListener("input", updateTotal));
    updateTotal();

    return el("div", { class: "card" },
      el("p", { class: "card-hint" },
        "Compliance weights determine each domain's contribution to the overall readiness score. Weights should total 100%. Regardless of weights, a failed critical item or open critical finding caps the overall rating (no misleading green)."),
      el("table", { class: "data-table" },
        el("thead", {}, el("tr", {}, el("th", {}, "Domain"), el("th", {}, "Weight (%)"))),
        el("tbody", {}, rows, el("tr", {}, el("td", {}, el("strong", {}, "Total")), totalCell))),
      el("div", { class: "form-foot" },
        el("button", { class: "btn", onclick: () => {
            DCS_TEMPLATE.DOMAINS.forEach((d) => { inputs[d.id].value = d.weight; });
            updateTotal();
          } }, "Reset to Defaults"),
        el("button", { class: "btn btn-primary", onclick: () => {
            const total = Object.values(inputs).reduce((s, i) => s + (parseFloat(i.value) || 0), 0);
            if (total !== 100) { UI.toast("Weights must total 100%.", "error"); return; }
            DCS_TEMPLATE.DOMAINS.forEach((d) => { ev.domainWeights[d.id] = parseFloat(inputs[d.id].value) || 0; });
            Store.save(); UI.toast("Weights saved.");
          } }, "Save Weights")));
  }

  /* --------------------------------------------------------- daily log */
  function dailyTab(ev) {
    const wrap = el("div", {});
    wrap.appendChild(el("div", { class: "list-toolbar" },
      el("p", { class: "card-hint" }, "Daily rollups during on-site execution: what was assessed, what broke, what was decided, and what happens next (issues → decisions → actions)."),
      el("button", { class: "btn btn-primary", onclick: () => editLog(ev, null) }, "+ Add Daily Rollup")));

    wrap.appendChild(el("div", { class: "card" },
      el("h3", { class: "card-title" }, "Recommended On-Site Execution Model"),
      el("table", { class: "data-table compact" },
        el("thead", {}, el("tr", {}, ["Day", "DCS Focus", "Assessment Activities"].map((h) => el("th", {}, h)))),
        el("tbody", {}, DCS_TEMPLATE.EXECUTION_MODEL.map((d) =>
          el("tr", {}, el("td", {}, el("strong", {}, d.day)), el("td", {}, d.focus), el("td", {}, d.activities)))))));

    if (ev.dailyLogs.length) {
      ev.dailyLogs.slice().reverse().forEach((log) => {
        wrap.appendChild(el("div", { class: "card daily-card" },
          el("div", { class: "list-toolbar" },
            el("h3", { class: "card-title" }, `${log.day}${log.date ? " — " + log.date : ""} · ${log.focus || ""}`),
            el("div", {},
              el("button", { class: "icon-btn", title: "Edit", onclick: () => editLog(ev, log) }, "✎"),
              el("button", { class: "icon-btn danger", title: "Delete", onclick: () =>
                UI.confirm("Delete rollup", `Delete the ${log.day} rollup?`, () => {
                  ev.dailyLogs = ev.dailyLogs.filter((l) => l.id !== log.id);
                  Store.save(); App.go("event");
                }) }, "🗑"))),
          el("dl", { class: "detail-list wide" },
            el("dt", {}, "Summary"), el("dd", {}, log.summary || "—"),
            el("dt", {}, "Issues"), el("dd", {}, log.issues || "—"),
            el("dt", {}, "Decisions"), el("dd", {}, log.decisions || "—"),
            el("dt", {}, "Actions"), el("dd", {}, log.actions || "—"))));
      });
    } else {
      wrap.appendChild(UI.empty("No daily rollups yet", "Capture a rollup at each day's hotwash."));
    }
    return wrap;
  }

  function editLog(ev, log) {
    const isNew = !log;
    const data = log || { id: Store.uid("DL"), day: "Day 1", date: "", focus: "", summary: "", issues: "", decisions: "", actions: "" };
    const dayS = select(DCS_TEMPLATE.EXECUTION_MODEL.map((d) => d.day), data.day);
    const dateI = input({ value: data.date, type: "date" });
    const focusI = input({ value: data.focus });
    const sumI = textarea({ value: data.summary, rows: 3 });
    const issI = textarea({ value: data.issues, rows: 2 });
    const decI = textarea({ value: data.decisions, rows: 2 });
    const actI = textarea({ value: data.actions, rows: 2 });
    UI.modal(isNew ? "Add Daily Rollup" : "Edit Daily Rollup", el("div", { class: "form-grid" },
      field("Day", dayS), field("Date", dateI), field("Focus", focusI),
      field("Summary", sumI), field("Issues", issI), field("Decisions", decI), field("Actions", actI)), [
      { label: "Cancel", onclick: () => {} },
      { label: isNew ? "Add" : "Save", primary: true, onclick: () => {
          Object.assign(data, { day: dayS.value, date: dateI.value, focus: focusI.value.trim(),
            summary: sumI.value.trim(), issues: issI.value.trim(), decisions: decI.value.trim(), actions: actI.value.trim() });
          if (isNew) ev.dailyLogs.push(data);
          Store.save(); App.go("event");
        } }]);
  }

  return { render, readinessChecks };
})();
