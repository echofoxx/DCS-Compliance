"use strict";
/**
 * XML SPIF (Security Policy Information File) validator + STANAG 4778
 * binding verification, server-side.
 *
 * Scope of the validator, on purpose:
 *   - Structural validation against a STANAG 4774 SPIF profile using a
 *     hand-written parser (no XSD dependency; the runtime supply chain
 *     stays small).
 *   - Policy extraction (identifier, classification list, releasability
 *     tokens, categories).
 *   - Cross-check against the assessment's protected data objects: does
 *     each asset's classification and releasability exist in the loaded
 *     SPIF?
 *   - STANAG 4778 signature verification of a supplied
 *     { label, signature, algorithm, publicKeyPem, hash } sample using
 *     the Node built-in `crypto` module — no external deps.
 *
 * What we deliberately don't do here: full XSD schema validation,
 * long-term policy management, and key custody. Public keys are provided
 * per verification request, never persisted with the assessment.
 */

const crypto = require("crypto");

const XML_NS_STANAG_4774 = "urn:nato:stanag:4774";
const HASH_ALGS = new Set(["sha256", "sha384", "sha512"]);
// Node's verify()/sign() accept these directly; keep the list explicit so
// callers can't wander into unsupported territory.
const SIG_ALGS = new Set(["RSA-SHA256", "RSA-SHA384", "RSA-SHA512",
  "RSA-PSS-SHA256", "RSA-PSS-SHA384", "RSA-PSS-SHA512",
  "ECDSA-SHA256", "ECDSA-SHA384", "ECDSA-SHA512"]);

/* ---------------------------------------------------------------- parsing */
/**
 * Micro XML parser tolerant enough for STANAG 4774 SPIFs but not a general
 * XML parser. Handles: elements, attributes (quoted values), text content,
 * comments, CDATA, and PIs. Rejects DOCTYPE (defeats a common XXE vector).
 * Returns a tree of { name, attrs, children, text } nodes.
 */
function parseXml(xml) {
  if (typeof xml !== "string") throw new Error("Expected an XML string.");
  if (xml.length > 2 * 1024 * 1024) throw new Error("SPIF over 2 MB — trim it first.");
  if (/<!DOCTYPE/i.test(xml)) throw new Error("DOCTYPE is not allowed (XXE hardening).");
  // Strip prologue, comments, CDATA (kept as text), and processing instructions.
  const stripped = xml
    .replace(/<\?xml[^?]*\?>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<\?[\s\S]*?\?>/g, "");
  const stack = [{ name: "#root", attrs: {}, children: [], text: "" }];
  let i = 0;
  const N = stripped.length;
  while (i < N) {
    // CDATA passes through as text on the current parent
    if (stripped.startsWith("<![CDATA[", i)) {
      const end = stripped.indexOf("]]>", i + 9);
      if (end < 0) throw new Error("Unterminated CDATA.");
      stack[stack.length - 1].text += stripped.slice(i + 9, end);
      i = end + 3; continue;
    }
    if (stripped[i] !== "<") {
      const nx = stripped.indexOf("<", i);
      const text = stripped.slice(i, nx < 0 ? N : nx);
      if (text.trim()) stack[stack.length - 1].text += decode(text);
      i = nx < 0 ? N : nx;
      continue;
    }
    const gt = stripped.indexOf(">", i + 1);
    if (gt < 0) throw new Error("Unclosed tag.");
    const raw = stripped.slice(i + 1, gt).trim();
    // closing tag </Name>
    if (raw.startsWith("/")) {
      const closing = raw.slice(1).trim().split(/\s+/)[0];
      const top = stack.pop();
      if (!top || top.name !== closing) throw new Error(`Mismatched closing tag </${closing}>.`);
      stack[stack.length - 1].children.push(top);
      i = gt + 1; continue;
    }
    // self-closing or opening tag
    const selfClose = raw.endsWith("/");
    const body = selfClose ? raw.slice(0, -1) : raw;
    const spaceIdx = body.search(/\s/);
    const name = spaceIdx < 0 ? body : body.slice(0, spaceIdx);
    if (!/^[A-Za-z_][A-Za-z0-9_:.-]*$/.test(name)) throw new Error(`Invalid tag name '${name}'.`);
    const attrs = parseAttrs(spaceIdx < 0 ? "" : body.slice(spaceIdx + 1));
    const node = { name, attrs, children: [], text: "" };
    if (selfClose) stack[stack.length - 1].children.push(node);
    else stack.push(node);
    i = gt + 1;
  }
  if (stack.length !== 1) throw new Error("Unclosed elements in SPIF.");
  return stack[0];
}

function parseAttrs(input) {
  const attrs = {};
  const re = /([A-Za-z_][A-Za-z0-9_:.-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(input)) !== null) attrs[m[1]] = decode(m[3] !== undefined ? m[3] : m[4]);
  return attrs;
}

function decode(s) {
  return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

/* ------------------------------------------------- SPIF profile validation */
/**
 * Validate a parsed tree against the STANAG 4774 SPIF profile. Returns
 * { policy, rules: [{ id, severity, ok, message }] }. Structural failures
 * are reported as CRITICAL; missing-but-recoverable data is WARN.
 */
function validateSPIF(root) {
  const rules = [];
  const push = (id, ok, severity, message) => rules.push({ id, ok, severity, message });

  const spifs = root.children.filter((c) => /(^|:)SPIF$/.test(c.name));
  if (spifs.length !== 1) {
    push("root.SPIF", false, "critical",
      spifs.length ? `Expected exactly one SPIF root element, found ${spifs.length}.`
                   : "SPIF root element is missing.");
    return { policy: null, rules };
  }
  const spif = spifs[0];
  push("root.SPIF", true, "critical", "Root SPIF element present.");

  // namespace on root: soft check
  const nsAttr = Object.entries(spif.attrs).find(([k]) => /^xmlns/i.test(k));
  const ns = nsAttr ? String(nsAttr[1]) : "";
  push("root.namespace", ns.startsWith(XML_NS_STANAG_4774), ns ? "warn" : "warn",
    ns ? (ns.startsWith(XML_NS_STANAG_4774) ? `Namespace ${ns}` : `Namespace ${ns} does not appear to be STANAG 4774.`)
       : "No xmlns declared on the root element.");

  // PolicyIdentifier: required, must have @Name or a text child
  const idNodes = childrenByLocal(spif, "PolicyIdentifier");
  if (idNodes.length !== 1) {
    push("policy.identifier", false, "critical",
      `PolicyIdentifier missing or duplicated (found ${idNodes.length}).`);
  } else {
    const id = idNodes[0].attrs.Name || idNodes[0].attrs.name || (idNodes[0].text || "").trim();
    push("policy.identifier", !!id, "critical",
      id ? `PolicyIdentifier: ${id}` : "PolicyIdentifier has no Name attribute or text content.");
  }

  // SecurityClassifications: required, must enumerate at least one
  const clsWrap = firstChildByLocal(spif, "SecurityClassifications");
  const classifications = clsWrap ? childrenByLocal(clsWrap, "SecurityClassification").map((c) => ({
    name: c.attrs.Name || c.attrs.name || (c.text || "").trim(),
    lacv: c.attrs.LACV || c.attrs.lacv || "",
    hierarchy: c.attrs.HierarchyValue || c.attrs.hierarchyValue || ""
  })).filter((c) => c.name) : [];
  push("policy.classifications", classifications.length > 0, "critical",
    classifications.length ? `${classifications.length} classification(s) declared.` :
      "No SecurityClassification elements found.");

  // SecurityCategories: optional but recommended
  const catWrap = firstChildByLocal(spif, "SecurityCategories");
  const categories = catWrap ? childrenByLocal(catWrap, "SecurityCategory").map((c) => ({
    name: c.attrs.Name || c.attrs.name || (c.text || "").trim(),
    type: c.attrs.CategoryType || c.attrs.categoryType || "",
    values: childrenByLocal(c, "GenericValue").map((g) => g.attrs.Name || g.attrs.name || (g.text || "").trim()).filter(Boolean)
  })).filter((c) => c.name) : [];
  push("policy.categories", true, categories.length ? "info" : "warn",
    categories.length ? `${categories.length} category set(s) declared.` :
      "No SecurityCategories declared (releasability tokens may still be embedded in classifications).");

  // Releasability tokens: STANAG SPIFs often express these as a Category
  // "Releasable To" or an explicit ReleasabilityMarking element. Accept
  // either shape.
  const releasabilityCat = categories.find((c) => /releas/i.test(c.name)) || categories.find((c) => /releas/i.test(c.type));
  let releasability = [];
  if (releasabilityCat) releasability = releasabilityCat.values.slice();
  const relMarkings = childrenByLocal(spif, "ReleasabilityMarkings");
  if (relMarkings) {
    releasability = releasability.concat(childrenByLocal(relMarkings, "Marking")
      .map((m) => m.attrs.Name || m.attrs.name || (m.text || "").trim()).filter(Boolean));
  }
  releasability = [...new Set(releasability)];
  push("policy.releasability", releasability.length > 0, "warn",
    releasability.length ? `${releasability.length} releasability token(s) enumerated.` :
      "No releasability tokens enumerated — coalition sharing rules cannot be validated against this SPIF.");

  const policy = {
    id: idNodes[0] ? (idNodes[0].attrs.Name || idNodes[0].attrs.name || (idNodes[0].text || "").trim()) : "",
    namespace: ns,
    classifications: classifications.map((c) => c.name),
    releasability,
    categories: categories.map((c) => ({ name: c.name, values: c.values }))
  };
  return { policy, rules };
}

function childrenByLocal(parent, local) {
  return (parent.children || []).filter((c) => c.name === local || c.name.endsWith(":" + local));
}
function firstChildByLocal(parent, local) {
  return childrenByLocal(parent, local)[0] || null;
}

/* --------------------------------------- asset coverage cross-check */
/**
 * Compare a policy to the assessment's registered protected data objects.
 * Emits per-asset findings: pass, warn (releasability partial), or fail
 * (classification not in the SPIF).
 */
function crossCheckAssets(policy, assets) {
  if (!policy) return [];
  const clsSet = new Set(policy.classifications.map((c) => norm(c)));
  const relSet = new Set(policy.releasability.map((r) => norm(r)));
  const findings = [];
  for (const a of assets) {
    const cls = String(a.classification || "").trim();
    const rel = String(a.releasability || "").trim();
    const clsOk = cls ? clsSet.has(norm(cls)) : true; // no classification declared → skip
    const relTokens = rel ? rel.split(/[,;/]/).map((s) => s.trim()).filter(Boolean) : [];
    const relMissing = relTokens.filter((t) => !relSet.has(norm(t)));
    const status = !clsOk ? "fail" : relMissing.length ? "warn" : "pass";
    findings.push({
      assetId: a.id || null, name: a.name || "(unnamed)",
      classification: cls, releasability: rel,
      status,
      message: !clsOk ? `Classification "${cls}" is not in the SPIF's allowed set.` :
        relMissing.length ? `Releasability token(s) not in the SPIF: ${relMissing.join(", ")}` :
        "OK — classification and releasability match the SPIF."
    });
  }
  return findings;
}
function norm(s) { return String(s).replace(/[\s_-]+/g, "").toLowerCase(); }

/* -------------------------------- STANAG 4778 binding verification */
/**
 * Verify a signature over the labelBytes using the supplied PEM public
 * key. Returns { valid, algorithm, hash, message }.
 *
 * Payload shape:
 *   { labelXml: string, signatureBase64: string, algorithm: string,
 *     hash: "sha256"|"sha384"|"sha512", publicKeyPem: string }
 *
 * Uses Node's crypto directly — no external deps.
 */
function verifyBinding(payload) {
  if (!payload || typeof payload !== "object") throw new Error("Missing binding payload.");
  const { labelXml, signatureBase64, algorithm, hash, publicKeyPem } = payload;
  if (typeof labelXml !== "string" || !labelXml.trim()) throw new Error("labelXml is required.");
  if (typeof signatureBase64 !== "string" || !signatureBase64.trim()) throw new Error("signatureBase64 is required.");
  if (!SIG_ALGS.has(algorithm)) throw new Error(`Unsupported algorithm '${algorithm}'.`);
  const hashName = hash || (algorithm.match(/SHA(\d+)/) ? "sha" + algorithm.match(/SHA(\d+)/)[1] : "sha256");
  if (!HASH_ALGS.has(hashName)) throw new Error(`Unsupported hash '${hashName}'.`);
  if (typeof publicKeyPem !== "string" || !/-----BEGIN [A-Z ]*PUBLIC KEY-----/.test(publicKeyPem))
    throw new Error("publicKeyPem must be PEM-encoded.");

  const pss = algorithm.startsWith("RSA-PSS-");
  const verifier = crypto.createVerify(nodeDigest(hashName));
  verifier.update(labelXml, "utf8");
  verifier.end();

  const keyObj = crypto.createPublicKey(publicKeyPem);
  const sig = Buffer.from(signatureBase64, "base64");
  const opts = { key: keyObj };
  if (pss) opts.padding = crypto.constants.RSA_PKCS1_PSS_PADDING;
  const valid = verifier.verify(opts, sig);

  const labelDigest = crypto.createHash(hashName).update(labelXml, "utf8").digest("hex");
  return {
    valid,
    algorithm,
    hash: hashName,
    labelDigestHex: labelDigest,
    message: valid ? "STANAG 4778 binding signature verifies against the supplied policy key."
                   : "Signature does NOT verify — treat this record as tampered or bound with a different key. See DCS-57."
  };
}

function nodeDigest(hash) {
  // Node accepts SHA256 etc as the canonical algorithm identifier for
  // createVerify; the string 'sha256' works for both createVerify and
  // createHash so we normalize.
  return hash;
}

module.exports = { parseXml, validateSPIF, crossCheckAssets, verifyBinding };
