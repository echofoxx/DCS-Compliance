"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("crypto");
const spif = require("../src/spif");

const SAMPLE = `<?xml version="1.0" encoding="UTF-8"?>
<SPIF xmlns="urn:nato:stanag:4774:confidentialitymetadatalabel:1:0">
  <PolicyIdentifier Name="Coalition-2027"/>
  <SecurityClassifications>
    <SecurityClassification Name="UNCLASSIFIED" HierarchyValue="1"/>
    <SecurityClassification Name="RESTRICTED" HierarchyValue="2"/>
    <SecurityClassification Name="SECRET" HierarchyValue="3"/>
  </SecurityClassifications>
  <SecurityCategories>
    <SecurityCategory Name="Releasable To" CategoryType="permissive">
      <GenericValue Name="USA"/>
      <GenericValue Name="GBR"/>
      <GenericValue Name="AUS"/>
    </SecurityCategory>
  </SecurityCategories>
</SPIF>`;

test("parseXml accepts a well-formed SPIF", () => {
  const tree = spif.parseXml(SAMPLE);
  const root = tree.children.find((c) => c.name === "SPIF");
  assert.ok(root, "root SPIF element present");
});

test("parseXml rejects DOCTYPE (XXE hardening)", () => {
  assert.throws(() => spif.parseXml('<!DOCTYPE foo><SPIF/>'), /DOCTYPE/);
});

test("validateSPIF extracts policy id, classifications, and releasability", () => {
  const tree = spif.parseXml(SAMPLE);
  const { policy, rules } = spif.validateSPIF(tree);
  assert.equal(policy.id, "Coalition-2027");
  assert.deepEqual(policy.classifications, ["UNCLASSIFIED", "RESTRICTED", "SECRET"]);
  assert.deepEqual(policy.releasability, ["USA", "GBR", "AUS"]);
  assert.ok(rules.find((r) => r.id === "policy.identifier" && r.ok));
  assert.ok(rules.find((r) => r.id === "policy.classifications" && r.ok));
});

test("validateSPIF reports critical failure when PolicyIdentifier is missing", () => {
  const noId = SAMPLE.replace(/<PolicyIdentifier[^/]*\/>/, "");
  const tree = spif.parseXml(noId);
  const { rules } = spif.validateSPIF(tree);
  const bad = rules.find((r) => r.id === "policy.identifier");
  assert.equal(bad.ok, false);
  assert.equal(bad.severity, "critical");
});

test("crossCheckAssets flags an unknown classification and a partial releasability", () => {
  const { policy } = spif.validateSPIF(spif.parseXml(SAMPLE));
  const findings = spif.crossCheckAssets(policy, [
    { id: "A1", name: "COP Feed", classification: "SECRET", releasability: "USA;GBR" },
    { id: "A2", name: "Mystery", classification: "TOP SECRET", releasability: "USA" },
    { id: "A3", name: "Partial", classification: "SECRET", releasability: "USA;FRA" }
  ]);
  const byId = Object.fromEntries(findings.map((f) => [f.assetId, f]));
  assert.equal(byId.A1.status, "pass");
  assert.equal(byId.A2.status, "fail");
  assert.match(byId.A2.message, /TOP SECRET/);
  assert.equal(byId.A3.status, "warn");
  assert.match(byId.A3.message, /FRA/);
});

test("verifyBinding accepts a good ECDSA-SHA256 signature and rejects a bad one", () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const publicKeyPem = publicKey.export({ format: "pem", type: "spki" });
  const labelXml = "<Label>Coalition-2027 SECRET REL USA,GBR</Label>";
  const sig = crypto.createSign("sha256").update(labelXml, "utf8").sign(privateKey);

  const good = spif.verifyBinding({
    labelXml, signatureBase64: sig.toString("base64"),
    algorithm: "ECDSA-SHA256", hash: "sha256", publicKeyPem
  });
  assert.equal(good.valid, true);
  assert.equal(good.algorithm, "ECDSA-SHA256");
  assert.ok(good.labelDigestHex.length === 64);

  const tampered = spif.verifyBinding({
    labelXml: labelXml + " X", signatureBase64: sig.toString("base64"),
    algorithm: "ECDSA-SHA256", hash: "sha256", publicKeyPem
  });
  assert.equal(tampered.valid, false);
});

test("verifyBinding rejects unsupported algorithms and bad payloads", () => {
  assert.throws(() => spif.verifyBinding({
    labelXml: "x", signatureBase64: "AA==", algorithm: "MD5", publicKeyPem: "-----BEGIN PUBLIC KEY-----\n-----END PUBLIC KEY-----"
  }), /Unsupported algorithm/);
  assert.throws(() => spif.verifyBinding({
    labelXml: "", signatureBase64: "AA==", algorithm: "ECDSA-SHA256", publicKeyPem: "-----BEGIN PUBLIC KEY-----\n-----END PUBLIC KEY-----"
  }), /labelXml/);
  assert.throws(() => spif.verifyBinding({
    labelXml: "x", signatureBase64: "AA==", algorithm: "ECDSA-SHA256", publicKeyPem: "not a pem"
  }), /PEM/);
});
