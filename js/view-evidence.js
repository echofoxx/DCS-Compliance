/* =========================================================================
 * DCS Assessment Command Center — Evidence Locker view
 * Evidence records with chain-of-custody metadata, optional file
 * attachments (stored locally as data URLs), quality grading, and
 * traceability links to checklist items, test cards, and findings.
 * ========================================================================= */

"use strict";

const ViewEvidence = (() => {
  const { el, field, input, textarea, select } = UI;

  const MAX_ATTACH_BYTES = 1.5 * 1024 * 1024; // localStorage is finite; larger files stay referenced by name/path only
  const filters = { type: "", quality: "", link: "", q: "" };

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
