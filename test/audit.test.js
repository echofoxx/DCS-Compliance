"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { changedPaths, stampAttribution, compactSnapshot, auditExcerpt } = require("../src/audit");

const user = { id: "00000000-0000-4000-8000-000000000001", username: "assessor", display_name: "DCS Assessor" };

test("changedPaths identifies record-level collection changes", () => {
  const before = { name: "Event", evidence: [{ id: "E1", title: "Before" }], checklist: [{ id: "DCS-01", score: 1 }] };
  const after = { name: "Event", evidence: [{ id: "E1", title: "After" }], checklist: [{ id: "DCS-01", score: 2 }] };
  const paths = changedPaths(before, after);
  assert.ok(paths.includes("evidence[E1].title"));
  assert.ok(paths.includes("checklist[DCS-01].score"));
});

test("stampAttribution stamps only new or changed child records", () => {
  const before = stampAttribution({ id: "EV1", name: "A", evidence: [{ id: "E1", title: "Same" }], findings: [] }, null, user, "2026-01-01T00:00:00.000Z");
  const after = stampAttribution({ ...before, name: "B", evidence: [...before.evidence, { id: "E2", title: "New" }] }, before, user, "2026-01-02T00:00:00.000Z");
  assert.equal(after._attribution.revision, 2);
  assert.equal(after.evidence[0]._attribution.updatedAt, "2026-01-01T00:00:00.000Z");
  assert.equal(after.evidence[1]._attribution.updatedBy.username, "assessor");
});

test("compactSnapshot removes encoded evidence bytes", () => {
  const snapshot = compactSnapshot({ evidence: [{ attachment: { name: "proof.png", dataUrl: "data:image/png;base64,ABC" } }] });
  assert.match(snapshot.evidence[0].attachment.dataUrl, /omitted/);
  assert.equal(snapshot.evidence[0].attachment.name, "proof.png");
});

test("auditExcerpt retains only changed records", () => {
  const state = { id: "A1", name: "Assessment", evidence: [{ id: "E1", title: "One" }, { id: "E2", title: "Two" }], findings: [{ id: "F1" }] };
  const result = auditExcerpt(state, ["evidence[E2].title"]);
  assert.deepEqual(result.evidence, [{ id: "E2", title: "Two" }]);
  assert.equal(result.findings, undefined);
});
