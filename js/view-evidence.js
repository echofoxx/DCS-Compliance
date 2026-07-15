/* =========================================================================
 * DCS Assessment Command Center — Evidence Locker view
 * Evidence records with chain-of-custody metadata, optional file
 * attachments (stored in the database as encoded evidence payloads), quality grading, and
 * traceability links to checklist items, test cards, and findings.
 * ========================================================================= */

"use strict";

const ViewEvidence = (() => {
  const { el, field, input, textarea, select } = UI;

  const MAX_ATTACH_BYTES = 5 * 1024 * 1024;   // protects API/database performance; larger files remain external references
  const MAX_LOG_RECORDS = 3000;               // cap ingested decision records per evidence item
  const filters = { type: "", quality: "", link: "", q: "" };

  /* ================================================== decision-log ingest
   * Accepts PDP/PEP/SIEM exports as CSV, a JSON array, {records:[...]},
   * or NDJSON. Column names are matched against common aliases so exports
   * from different tools normalize into the white paper's evidence schema.
   * ==================================================================== */
  const LOG_ALIASES = {
    timestamp: ["timestamp", "time", "datetime", "date", "event_time", "_timestamp"],
    user:      ["user", "requestor", "subject", "username", "principal", "consumer_system_or_user", "consumer"],
    asset:     ["asset", "resource", "object", "target", "protected_asset_id", "data_object", "asset_id"],
    action:    ["action", "access_action", "operation", "request_action"],
    decision:  ["decision", "actual_outcome", "actual_dcs_outcome", "outcome", "result", "pdp_decision"],
    expected:  ["expected", "expected_outcome", "expected_dcs_outcome"],
    reason:    ["reason", "reason_code", "policy_id", "policy", "rule", "rule_id"],
    pep:       ["pep", "pep_result", "enforcement", "enforcement_result", "enforcement_point"],
    latencyMs: ["latency_ms", "decision_latency_ms", "latency", "response_time_ms"]
  };

  function normalizeLogRecord(raw) {
    const lower = {};
    Object.keys(raw).forEach((k) => {
      lower[k.toLowerCase().replace(/^@/, "_").replace(/[^a-z0-9_]+/g, "_")] = raw[k];
    });
    const pick = (field) => {
      for (const alias of LOG_ALIASES[field]) {
        if (lower[alias] !== undefined && lower[alias] !== null && String(lower[alias]).trim() !== "")
          return String(lower[alias]).trim();
      }
      return "";
    };
    const rec = {
      timestamp: pick("timestamp"), user: pick("user"), asset: pick("asset"),
      action: pick("action"), decision: pick("decision"), expected: pick("expected"),
      reason: pick("reason"), pep: pick("pep"),
      latencyMs: parseFloat(pick("latencyMs")) || null
    };
    return (rec.decision || rec.user || rec.asset) ? rec : null;
  }

  // Classify free-text decisions so different tools compare consistently.
  function decisionClass(text) {
    const t = (text || "").toLowerCase();
    if (!t) return "unknown";
    if (/(allow|permit|grant|success|200|accepted)/.test(t)) return "allow";
    if (/(deny|denied|block|reject|refuse|forbid|403|401|quarantine)/.test(t)) return "deny";
    if (/(redact|mask|filter|partial|watermark)/.test(t)) return "modified";
    if (/(alert|review|manual)/.test(t)) return "review";
    return "unknown";
  }

  function logStats(records) {
    const s = { total: records.length, allow: 0, deny: 0, modified: 0, other: 0,
      compared: 0, mismatches: 0, falseAllows: 0, falseDenies: 0,
      latencies: [], users: new Set(), assets: new Set(), firstTs: "", lastTs: "" };
    records.forEach((r) => {
      const dc = decisionClass(r.decision);
      if (dc === "allow") s.allow++; else if (dc === "deny") s.deny++;
      else if (dc === "modified") s.modified++; else s.other++;
      if (r.expected) {
        const ec = decisionClass(r.expected);
        if (ec !== "unknown" && dc !== "unknown") {
          s.compared++;
          if (ec !== dc) {
            s.mismatches++;
            if (ec === "deny" && dc === "allow") s.falseAllows++;
            if (ec === "allow" && dc === "deny") s.falseDenies++;
          }
        }
      }
      if (r.latencyMs !== null) s.latencies.push(r.latencyMs);
      if (r.user) s.users.add(r.user);
      if (r.asset) s.assets.add(r.asset);
      if (r.timestamp) {
        if (!s.firstTs || r.timestamp < s.firstTs) s.firstTs = r.timestamp;
        if (!s.lastTs || r.timestamp > s.lastTs) s.lastTs = r.timestamp;
      }
    });
    s.avgLatency = s.latencies.length ? s.latencies.reduce((a, b) => a + b, 0) / s.latencies.length : null;
    return s;
  }

  function parseLogFile(name, text) {
    let rows = [];
    if (/\.json$/i.test(name) || /^\s*[\[{]/.test(text)) {
      try {
        const data = JSON.parse(text);
        rows = Array.isArray(data) ? data : (Array.isArray(data.records) ? data.records : null);
        if (!rows) throw new Error("not an array");
      } catch (e) {
        // NDJSON: one JSON object per line
        rows = text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => {
          try { return JSON.parse(l); } catch (e2) { return null; }
        }).filter(Boolean);
      }
    } else {
      rows = Store.parseCSV(text);
    }
    return rows.map(normalizeLogRecord).filter(Boolean).slice(0, MAX_LOG_RECORDS);
  }

  function ingestLog(ev) {
    const fi = el("input", { type: "file", accept: ".csv,.json,.ndjson,.log,text/csv,application/json" });
    fi.addEventListener("change", () => {
      const f = fi.files[0];
      if (!f) return;
      if (f.size > 8 * 1024 * 1024) { UI.toast("Log file over 8 MB — filter the export to the event window first.", "error"); return; }
      const reader = new FileReader();
      reader.onload = () => {
        const records = parseLogFile(f.name, String(reader.result));
        if (!records.length) {
          UI.toast("No decision records recognized. Expected columns like timestamp, user, asset, decision (see Log Template).", "error");
          return;
        }
        const s = logStats(records);
        const rec = {
          id: Store.uid("EVD"),
          title: `Decision log ingest — ${f.name}`,
          type: "Decision Record",
          sourceSystem: "", capturedBy: "", capturedAt: Store.nowISO(),
          classification: ev.classification || "UNCLASSIFIED",
          quality: "strong",
          description: `Ingested ${s.total} decision record(s): ${s.allow} allow, ${s.deny} deny, ${s.modified} redact/mask/filter. ` +
            (s.compared ? `${s.mismatches} of ${s.compared} compared records mismatch expected outcomes (${s.falseAllows} false allow, ${s.falseDenies} false deny). ` : "") +
            (s.avgLatency !== null ? `Avg decision latency ${Math.round(s.avgLatency)} ms.` : ""),
          fileName: f.name, fileDataUrl: "", fileSize: f.size,
          records,
          links: { checklist: [], testCards: [], findings: [] }
        };
        ev.evidence.push(rec);
        Store.save();
        UI.toast(`Ingested ${s.total} records${s.falseAllows ? ` — ⚠ ${s.falseAllows} possible FALSE ALLOW(S)` : ""}.`, s.falseAllows ? "error" : "ok");
        App.go("evidence", { open: rec.id });
      };
      reader.readAsText(f);
    });
    fi.click();
  }

  function logTemplate() {
    Store.download("dcs-decision-log-template.csv",
      "timestamp,user,asset,action,decision,expected,reason,pep_result,latency_ms\r\n" +
      "2026-10-14T09:12:03Z,partner.x.analyst,COP Feed,read,DENY,deny,REL-NOMATCH-004,403 returned,95\r\n" +
      "2026-10-14T09:14:22Z,us.watch.officer,COP Feed,read,PERMIT,allow,ROLE-J3-COP,served,120\r\n",
      "text/csv");
  }

  function render(container, params = {}) {
    const ev = Store.activeEvent();
    container.innerHTML = "";
    const view = el("div", { class: "view" });

    const unlinked = ev.evidence.filter((e) =>
      !e.links.checklist.length && !e.links.testCards.length && !e.links.findings.length).length;

    view.appendChild(el("div", { class: "view-head" },
      el("div", {},
        el("h1", {}, "Evidence Locker"),
        el("p", { class: "view-sub" }, "Every score and finding should trace to evidence here: who captured it, where it came from, when, under what handling, and what it proves.")),
      el("div", { class: "view-actions" },
        el("button", { class: "btn", title: "Column reference for decision-log exports", onclick: logTemplate }, "Log Template"),
        el("button", { class: "btn", title: "Import a PDP/PEP/SIEM decision log export (CSV, JSON, or NDJSON)", onclick: () => ingestLog(ev) }, "⇪ Ingest Decision Log"),
        el("button", { class: "btn", onclick: () => Store.exportEvidenceCSV(ev) }, "Export Evidence Index"),
        el("button", { class: "btn btn-primary", onclick: () => editEvidence(ev, null) }, "+ Add Evidence"))));

    view.appendChild(el("div", { class: "tile-grid tiles-4" },
      Charts.statTile("Evidence Items", ev.evidence.length, { sub: "in the locker" }),
      Charts.statTile("Strong Quality", ev.evidence.filter((e) => e.quality === "strong").length, { sub: "defensible on their own" }),
      Charts.statTile("Weak Quality", ev.evidence.filter((e) => e.quality === "weak").length,
        { tone: ev.evidence.some((e) => e.quality === "weak") ? "warning" : null, sub: "needs corroboration" }),
      Charts.statTile("Unlinked", unlinked, { tone: unlinked ? "warning" : "good", sub: "not tied to any item yet" })));

    /* filters */
    const mkSel = (key, options, placeholder) => {
      const s = select([{ value: "", label: placeholder }, ...options], filters[key]);
      s.addEventListener("change", () => { filters[key] = s.value; App.go("evidence"); });
      return s;
    };
    const q = input({ value: filters.q, placeholder: "Search evidence…", class: "input search-input" });
    let timer;
    q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => { filters.q = q.value; App.go("evidence"); }, 250); });
    view.appendChild(el("div", { class: "filter-bar" },
      q,
      mkSel("type", DCS_TEMPLATE.EVIDENCE_TYPES.map((t) => ({ value: t, label: t })), "Any type"),
      mkSel("quality", DCS_TEMPLATE.EVIDENCE_QUALITY.map((x) => ({ value: x.id, label: x.label })), "Any quality"),
      mkSel("link", [{ value: "unlinked", label: "Unlinked only" }, { value: "linked", label: "Linked only" }], "Any linkage"),
      el("button", { class: "btn btn-ghost", onclick: () => { Object.keys(filters).forEach((k) => filters[k] = ""); App.go("evidence"); } }, "Clear")));

    const list = ev.evidence.filter((e) => {
      const linked = e.links.checklist.length + e.links.testCards.length + e.links.findings.length > 0;
      if (filters.type && e.type !== filters.type) return false;
      if (filters.quality && e.quality !== filters.quality) return false;
      if (filters.link === "unlinked" && linked) return false;
      if (filters.link === "linked" && !linked) return false;
      if (filters.q && !(`${e.title} ${e.description} ${e.sourceSystem}`.toLowerCase().includes(filters.q.toLowerCase()))) return false;
      return true;
    });

    if (!list.length) {
      view.appendChild(UI.empty("No evidence records", "Add screenshots, logs, exports, observations, interviews, samples, and decision records."));
    } else {
      view.appendChild(el("div", { class: "card table-card" },
        el("table", { class: "data-table" },
          el("thead", {}, el("tr", {},
            ["Evidence", "Type", "Source System", "Captured By", "Captured", "Handling", "Quality", "Links", ""].map((h) => el("th", {}, h)))),
          el("tbody", {}, list.map((e) => {
            const linkCount = e.links.checklist.length + e.links.testCards.length + e.links.findings.length;
            return el("tr", { class: "clickable", onclick: () => openEvidence(ev, e) },
              el("td", {}, el("strong", {}, e.title),
                e.fileName ? el("div", { class: "cell-sub" }, `📎 ${e.fileName}`) : null),
              el("td", {}, e.type),
              el("td", {}, e.sourceSystem || "—"),
              el("td", {}, e.capturedBy || "—"),
              el("td", {}, UI.fmtDate(e.capturedAt)),
              el("td", {}, UI.badge(e.classification || "—", "info")),
              el("td", {}, UI.qualityBadge(e.quality)),
              el("td", {}, UI.badge(String(linkCount), linkCount ? "good" : "warning")),
              el("td", { onclick: (ec) => ec.stopPropagation() },
                el("button", { class: "icon-btn", title: "Edit", onclick: () => editEvidence(ev, e) }, "✎"),
                el("button", { class: "icon-btn danger", title: "Delete", onclick: () =>
                  UI.confirm("Delete evidence", `Delete “${e.title}”? All links to checklist items, test cards, and findings will be removed.`, () => {
                    Store.deleteEvidence(ev, e.id);
                    Store.save(); App.go("evidence");
                  }) }, "🗑")));
          })))));
    }

    container.appendChild(view);
    if (params.open) {
      const e = ev.evidence.find((x) => x.id === params.open);
      if (e) openEvidence(ev, e);
    }
  }

  /* ------------------------------------------------------------- drill-in */
  function openEvidence(ev, e) {
    const linkList = (title, ids, resolve, go) => el("div", {},
      el("h4", { class: "drawer-h" }, `${title} (${ids.length})`),
      ids.length ? el("ul", { class: "mini-list" }, ids.map((id) => {
        const item = resolve(id);
        return item ? el("li", { class: "mini-row clickable", onclick: () => { UI.closeDrawer(); go(id); } },
          el("span", { class: "mini-id" }, item.idLabel || ""), el("span", { class: "mini-title" }, item.label)) : null;
      })) : el("p", { class: "empty-mini" }, "None."));

    UI.drawer(e.title, `Evidence · ${e.type}`, el("div", {},
      UI.attribution(e),
      el("dl", { class: "detail-list" },
        el("dt", {}, "Evidence ID"), el("dd", {}, e.id),
        el("dt", {}, "Source System"), el("dd", {}, e.sourceSystem || "—"),
        el("dt", {}, "Captured By"), el("dd", {}, e.capturedBy || "—"),
        el("dt", {}, "Timestamp"), el("dd", {}, UI.fmtDate(e.capturedAt)),
        el("dt", {}, "Classification / Handling"), el("dd", {}, UI.badge(e.classification || "—", "info")),
        el("dt", {}, "Quality"), el("dd", {}, UI.qualityBadge(e.quality)),
        el("dt", {}, "Description"), el("dd", {}, e.description || "—")),
      e.fileDataUrl && e.fileDataUrl.startsWith("data:image")
        ? el("div", { class: "evidence-preview" }, el("img", { src: e.fileDataUrl, alt: e.title }))
        : null,
      e.records && e.records.length ? auditTimeline(e) : null,
      e.fileName ? el("div", { class: "drawer-actions" },
        e.fileDataUrl
          ? el("a", { class: "btn", href: e.fileDataUrl, download: e.fileName }, `Download ${e.fileName}`)
          : el("span", { class: "empty-mini" }, `Referenced file (not stored locally): ${e.fileName}`)) : null,
      linkList("Linked Checklist Items", e.links.checklist,
        (id) => { const t = Store.templateItem(id); return t ? { idLabel: id, label: t.requirement } : null; },
        (id) => App.go("checklist", { open: id })),
      linkList("Linked Test Cards", e.links.testCards,
        (id) => { const t = ev.testCards.find((x) => x.id === id); return t ? { label: t.title } : null; },
        (id) => App.go("testcards", { open: id })),
      linkList("Linked Findings", e.links.findings,
        (id) => { const f = ev.findings.find((x) => x.id === id); return f ? { label: f.title } : null; },
        (id) => App.go("findings", { open: id })),
      el("div", { class: "drawer-actions" },
        el("button", { class: "btn btn-primary", onclick: () => { UI.closeDrawer(); editEvidence(ev, e); } }, "Edit"))));
  }

  /* --------------------------------------------- audit reconstruction */
  // Rendered inside the drawer for ingested decision-log evidence: summary
  // stats, false-allow alerting, and a filterable chronological timeline.
  function auditTimeline(e) {
    const s = logStats(e.records);
    const wrap = el("div", { class: "audit-timeline" });

    wrap.appendChild(el("h4", { class: "drawer-h" }, "Audit Reconstruction"));
    if (s.falseAllows) {
      wrap.appendChild(el("div", { class: "gate-note" },
        el("strong", {}, `⚠ ${s.falseAllows} possible FALSE ALLOW record(s): `),
        "expected deny, observed allow. Verify against the expected allow/deny matrix — a confirmed false allow is a critical finding (DCS-31)."));
    }
    wrap.appendChild(el("div", { class: "audit-stats" },
      statChip("Records", s.total),
      statChip("Allows", s.allow),
      statChip("Denies", s.deny),
      statChip("Redact/Mask", s.modified),
      s.compared ? statChip("Mismatches", `${s.mismatches}/${s.compared}`, s.mismatches ? "critical" : "good") : null,
      s.falseDenies ? statChip("False denies", s.falseDenies, "warning") : null,
      s.avgLatency !== null ? statChip("Avg latency", `${Math.round(s.avgLatency)} ms`) : null,
      statChip("Users", s.users.size),
      statChip("Assets", s.assets.size)));

    if (s.firstTs) {
      wrap.appendChild(el("p", { class: "card-hint" }, `Window: ${s.firstTs} → ${s.lastTs}`));
    }

    // filter + table (chronological)
    const q = el("input", { class: "input", placeholder: "Filter timeline (user, asset, decision, reason)…" });
    const only = UI.select([
      { value: "", label: "All records" },
      { value: "mismatch", label: "Mismatches only" },
      { value: "deny", label: "Denies only" },
      { value: "allow", label: "Allows only" }
    ], "");
    const tableWrap = el("div", { class: "log-scroll" });

    const renderRows = () => {
      const needle = q.value.toLowerCase();
      const sorted = e.records.slice().sort((a, b) => (a.timestamp || "").localeCompare(b.timestamp || ""));
      const list = sorted.filter((r) => {
        const dc = decisionClass(r.decision);
        const mismatch = r.expected && decisionClass(r.expected) !== "unknown" && dc !== "unknown" &&
          decisionClass(r.expected) !== dc;
        if (only.value === "mismatch" && !mismatch) return false;
        if (only.value === "deny" && dc !== "deny") return false;
        if (only.value === "allow" && dc !== "allow") return false;
        if (needle && !(`${r.user} ${r.asset} ${r.decision} ${r.reason} ${r.action}`.toLowerCase().includes(needle))) return false;
        return true;
      });
      const shown = list.slice(0, 300);
      tableWrap.innerHTML = "";
      tableWrap.appendChild(el("table", { class: "data-table compact" },
        el("thead", {}, el("tr", {}, ["Time", "User", "Asset", "Action", "Decision", "Expected", "Reason / Policy"].map((h) => el("th", {}, h)))),
        el("tbody", {}, shown.map((r) => {
          const dc = decisionClass(r.decision);
          const mismatch = r.expected && decisionClass(r.expected) !== "unknown" && dc !== "unknown" &&
            decisionClass(r.expected) !== dc;
          return el("tr", { class: mismatch ? "log-mismatch" : "" },
            el("td", {}, r.timestamp || "—"),
            el("td", {}, r.user || "—"),
            el("td", {}, r.asset || "—"),
            el("td", {}, r.action || "—"),
            el("td", {}, UI.badge(r.decision || "—", dc === "allow" ? "good" : dc === "deny" ? "info" : dc === "modified" ? "warning" : "muted")),
            el("td", {}, r.expected ? UI.badge(r.expected, mismatch ? "critical" : "muted") : "—"),
            el("td", {}, [r.reason, r.pep].filter(Boolean).join(" · ") || "—"));
        }))));
      if (list.length > shown.length) {
        tableWrap.appendChild(el("p", { class: "empty-mini" }, `Showing first ${shown.length} of ${list.length} matching records — refine the filter to narrow further.`));
      }
      if (!list.length) tableWrap.appendChild(el("p", { class: "empty-mini" }, "No records match the filter."));
    };
    let timer;
    q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(renderRows, 200); });
    only.addEventListener("change", renderRows);

    wrap.appendChild(el("div", { class: "audit-filter" }, q, only));
    renderRows();
    wrap.appendChild(tableWrap);
    return wrap;
  }

  function statChip(label, value, tone) {
    return el("span", { class: `audit-chip${tone ? " tone-" + tone : ""}` },
      el("span", { class: "audit-chip-label" }, label), String(value));
  }

  /* ------------------------------------------------------------ edit form */
  // presets: partial evidence object (used by "+ New Evidence for This Item")
  // onDone: callback after save (to reopen the caller's drawer)
  function editEvidence(ev, e, presets = {}, onDone = null) {
    const isNew = !e;
    const data = e || Object.assign({
      id: Store.uid("EVD"), title: "", type: DCS_TEMPLATE.EVIDENCE_TYPES[0],
      sourceSystem: "", capturedBy: "", capturedAt: Store.nowISO(),
      classification: ev.classification || "UNCLASSIFIED", quality: "moderate",
      description: "", fileName: "", fileDataUrl: "", fileSize: 0,
      links: { checklist: [], testCards: [], findings: [] }
    }, presets);

    const titleI = input({ value: data.title });
    const typeS = select(DCS_TEMPLATE.EVIDENCE_TYPES, data.type);
    const srcS = ev.systems.length
      ? select([{ value: "", label: "—" }, ...ev.systems.map((s) => ({ value: s.name, label: s.name })), { value: data.sourceSystem && !ev.systems.some((s) => s.name === data.sourceSystem) ? data.sourceSystem : "__other", label: data.sourceSystem && !ev.systems.some((s) => s.name === data.sourceSystem) ? data.sourceSystem : "Other…" }], data.sourceSystem)
      : input({ value: data.sourceSystem });
    const capI = input({ value: data.capturedBy });
    const clsS = select(DCS_TEMPLATE.CLASSIFICATIONS, data.classification);
    const qS = select(DCS_TEMPLATE.EVIDENCE_QUALITY.map((x) => ({ value: x.id, label: x.label })), data.quality);
    const descI = textarea({ value: data.description, rows: 3, placeholder: "What this evidence shows and why it matters…" });
    const fileI = el("input", { type: "file", class: "input" });
    const fileNote = el("div", { class: "field-hint" },
      data.fileName ? `Current: ${data.fileName}` : `Files under ${(MAX_ATTACH_BYTES / 1024 / 1024).toFixed(1)} MB are stored in the app; larger files are referenced by name only (keep them in your event evidence folder).`);

    const clPick = UI.checkList(DCS_TEMPLATE.CHECKLIST.map((c) => ({ value: c.id, label: `${c.id} — ${c.requirement}` })), data.links.checklist, "ev-cl");
    const tcPick = UI.checkList(ev.testCards.map((t) => ({ value: t.id, label: t.title })), data.links.testCards, "ev-tc");
    const fPick = UI.checkList(ev.findings.map((f) => ({ value: f.id, label: f.title })), data.links.findings, "ev-f");

    let pendingFile = null; // {name, dataUrl|null, size}
    fileI.addEventListener("change", () => {
      const f = fileI.files[0];
      if (!f) return;
      if (f.size > MAX_ATTACH_BYTES) {
        pendingFile = { name: f.name, dataUrl: "", size: f.size };
        fileNote.textContent = `“${f.name}” is ${(f.size / 1024 / 1024).toFixed(1)} MB — it will be referenced by name only. Keep the file in your event evidence folder.`;
      } else {
        const reader = new FileReader();
        reader.onload = () => { pendingFile = { name: f.name, dataUrl: reader.result, size: f.size }; };
        reader.readAsDataURL(f);
        fileNote.textContent = `“${f.name}” will be stored with this record.`;
      }
    });

    UI.modal(isNew ? "Add Evidence" : "Edit Evidence", el("div", {},
      el("div", { class: "form-grid" },
        field("Title", titleI), field("Evidence Type", typeS),
        field("Source System", srcS), field("Captured By", capI),
        field("Classification / Handling", clsS), field("Evidence Quality", qS)),
      field("Description / Analyst Context", descI),
      field("Attachment", el("div", {}, fileI, fileNote)),
      el("details", { class: "picker-details", open: !!presets.links },
        el("summary", {}, "Link to checklist items"), clPick),
      ev.testCards.length ? el("details", { class: "picker-details" },
        el("summary", {}, "Link to test cards"), tcPick) : null,
      ev.findings.length ? el("details", { class: "picker-details" },
        el("summary", {}, "Link to findings"), fPick) : null), [
      { label: "Cancel", onclick: () => { if (onDone) onDone(); } },
      { label: isNew ? "Add Evidence" : "Save", primary: true, onclick: () => {
          if (!titleI.value.trim()) { UI.toast("Title is required.", "error"); return false; }
          const oldLinks = JSON.parse(JSON.stringify(data.links));
          Object.assign(data, {
            title: titleI.value.trim(), type: typeS.value,
            sourceSystem: srcS.value === "__other" ? "" : (srcS.value || "").trim(),
            capturedBy: capI.value.trim(), classification: clsS.value, quality: qS.value,
            description: descI.value.trim()
          });
          if (pendingFile) {
            data.fileName = pendingFile.name;
            data.fileDataUrl = pendingFile.dataUrl;
            data.fileSize = pendingFile.size;
          }
          data.links = {
            checklist: UI.checkedValues(clPick, "ev-cl"),
            testCards: UI.checkedValues(tcPick, "ev-tc"),
            findings: UI.checkedValues(fPick, "ev-f")
          };
          if (isNew) ev.evidence.push(data);
          // reconcile bidirectional links
          ["checklist", "testCards", "findings"].forEach((kind) => {
            oldLinks[kind].filter((id) => !data.links[kind].includes(id))
              .forEach((id) => Store.unlinkEvidence(ev, data.id, kind, id));
            data.links[kind].forEach((id) => Store.linkEvidence(ev, data.id, kind, id));
          });
          Store.save();
          UI.toast(isNew ? "Evidence added." : "Evidence saved.");
          if (onDone) onDone(); else App.go("evidence");
        } }]);
  }

  return { render, editEvidence };
})();
