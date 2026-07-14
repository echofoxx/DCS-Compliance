/* =========================================================================
 * DCS Assessment Command Center — Local AI Drafting Assistant (optional)
 *
 * Talks to a locally hosted model (Ollama by default) to DRAFT text:
 * finding impact/recommendation statements and the executive narrative.
 *
 * Guardrails, by design:
 *  - Drafting only. The assistant never scores items, never changes a
 *    result, and never certifies compliance. Everything it produces lands
 *    in an editable field for the assessor to review and own.
 *  - Local only. The endpoint defaults to localhost; nothing is sent to
 *    a cloud service. If no local model is running, features degrade to
 *    a clear explanation of how to enable them.
 * ========================================================================= */

"use strict";

const Assistant = (() => {
  const { el, field, input } = UI;

  const DEFAULTS = { endpoint: "http://localhost:11434", model: "llama3.1", enabled: false };

  function cfg() {
    const st = Store.getState();
    if (!st.settings.ai) st.settings.ai = Object.assign({}, DEFAULTS);
    return st.settings.ai;
  }
  const isEnabled = () => !!cfg().enabled;

  /* ------------------------------------------------------------ transport */
  async function draft(system, prompt) {
    const c = cfg();
    const res = await fetch(`${c.endpoint.replace(/\/$/, "")}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: c.model, system, prompt, stream: false })
    });
    if (!res.ok) throw new Error(`Local model returned HTTP ${res.status}`);
    const data = await res.json();
    if (!data.response) throw new Error("Local model returned an empty response.");
    return data.response.trim();
  }

  function explainFailure(err) {
    UI.toast("Local AI unavailable — see the Local AI settings for setup help.", "error");
    console.warn("Assistant error:", err);
  }

  /* -------------------------------------------------------------- prompts */
  const SYSTEM = "You are a drafting assistant for a Data-Centric Security (DCS) / Zero Trust compliance assessment team. " +
    "Write in a precise, professional, DoD-assessment tone. Draft only — the assessor reviews and edits everything. " +
    "Never claim compliance is certified; describe observed evidence and its implications. Be concise.";

  async function draftFinding(context) {
    const prompt =
`Draft two short paragraphs for a DCS assessment finding.

Finding title: ${context.title || "(untitled)"}
Severity: ${context.severity}
DCS domain: ${context.domain}
Related compliance requirement(s): ${context.requirements.join(" | ") || "none linked"}
Test result context: ${context.tests.join(" | ") || "none linked"}
Evidence available: ${context.evidence.join(" | ") || "none linked"}
Assessor notes: ${context.notes || "none"}

Respond in exactly this format (no extra headers):
IMPACT: <2-3 sentences on the mission and security implication if unresolved>
RECOMMENDATION: <2-3 sentences of prioritized, actionable remediation>`;
    const text = await draft(SYSTEM, prompt);
    const impact = (text.match(/IMPACT:\s*([\s\S]*?)(?=RECOMMENDATION:|$)/i) || [])[1];
    const rec = (text.match(/RECOMMENDATION:\s*([\s\S]*)/i) || [])[1];
    return { impact: (impact || text).trim(), recommendation: (rec || "").trim() };
  }

  async function draftNarrative(ev, s) {
    const domains = s.domains.filter((d) => d.avgScore !== null)
      .map((d) => `${d.name}: ${d.avgScore.toFixed(1)}/4`).join("; ");
    const criticals = ev.findings.filter((f) => f.severity === "critical" && f.status !== "closed")
      .map((f) => f.title).join("; ");
    const strengths = ev.findings.filter((f) => f.severity === "strength")
      .map((f) => f.title).join("; ");
    const prompt =
`Draft a 2-paragraph executive narrative for the final DCS assessment report.

Event: ${ev.name} (${ev.location || "location TBD"}, ${ev.eventWindow || "window TBD"})
Overall weighted readiness: ${s.overallPct === null ? "not yet assessed" : Math.round(s.overallPct * 100) + "%"} — rating: ${s.rating.label}
Rating capped by critical gap: ${s.gated ? "yes" : "no"}
Assessment coverage: ${Math.round(s.coverage * 100)}% of applicable checklist items scored
Evidence completeness: ${Math.round(s.evidenceCompleteness * 100)}%
Domain scores: ${domains || "none yet"}
Open critical findings: ${criticals || "none"}
Strengths observed: ${strengths || "none recorded"}

Paragraph 1: what the event demonstrated about DCS capability, grounded in the numbers above.
Paragraph 2: the leadership takeaway — key risks, what must happen before the capability scales.
Do not invent facts not present above. Plain prose, no headers or bullet lists.`;
    return draft(SYSTEM, prompt);
  }

  /* ------------------------------------------------------------ UI pieces */
  // A button that runs an async draft action with a busy state and failure toast.
  function draftButton(label, action) {
    const btn = el("button", { class: "btn ai-btn", type: "button" }, `✦ ${label}`);
    btn.addEventListener("click", async () => {
      if (!isEnabled()) { configModal(); return; }
      btn.disabled = true;
      const orig = btn.textContent;
      btn.textContent = "✦ Drafting…";
      try { await action(); UI.toast("Draft inserted — review and edit before saving."); }
      catch (err) { explainFailure(err); }
      finally { btn.disabled = false; btn.textContent = orig; }
    });
    return btn;
  }

  function configModal() {
    const c = cfg();
    const enabledI = el("input", { type: "checkbox", checked: c.enabled });
    const endpointI = input({ value: c.endpoint, placeholder: DEFAULTS.endpoint });
    const modelI = input({ value: c.model, placeholder: DEFAULTS.model });
    const testOut = el("div", { class: "field-hint" });

    UI.modal("Local AI Assistant", el("div", {},
      el("p", { class: "card-hint" },
        "Optional drafting help from a model running on this machine (Ollama). The assistant drafts finding statements and the executive narrative into editable fields — it never scores items or certifies compliance, and nothing leaves the local machine."),
      el("label", { class: "check-row" }, enabledI, el("span", {}, "Enable local AI drafting")),
      el("div", { class: "form-grid" },
        field("Endpoint", endpointI, "Ollama default: http://localhost:11434"),
        field("Model", modelI, "Any locally pulled model, e.g. llama3.1, mistral")),
      el("button", { class: "btn", onclick: async (e) => {
          e.target.disabled = true;
          testOut.textContent = "Testing…";
          try {
            const res = await fetch(`${endpointI.value.replace(/\/$/, "")}/api/tags`);
            const data = await res.json();
            const names = (data.models || []).map((m) => m.name).join(", ");
            testOut.textContent = names ? `Connected. Available models: ${names}` : "Connected, but no models pulled yet (run: ollama pull llama3.1).";
          } catch (err) {
            testOut.textContent = "Could not reach the endpoint. Is Ollama running? (install from ollama.com, then `ollama serve`). If the app is opened from file://, serve it over http://localhost instead so the browser allows the request.";
          }
          e.target.disabled = false;
        } }, "Test Connection"),
      testOut), [
      { label: "Cancel", onclick: () => {} },
      { label: "Save", primary: true, onclick: () => {
          Object.assign(cfg(), {
            enabled: enabledI.checked,
            endpoint: endpointI.value.trim() || DEFAULTS.endpoint,
            model: modelI.value.trim() || DEFAULTS.model
          });
          Store.save();
          UI.toast(`Local AI drafting ${enabledI.checked ? "enabled" : "disabled"}.`);
        } }]);
  }

  return { isEnabled, draftFinding, draftNarrative, draftButton, configModal };
})();
