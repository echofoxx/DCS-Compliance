"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const rbac = require("../src/rbac");

test("all required assessment roles are unique and carry view access", () => {
  assert.equal(new Set(rbac.ROLE_DEFINITIONS.map((r) => r.id)).size, rbac.ROLE_DEFINITIONS.length);
  for (const role of rbac.ROLE_DEFINITIONS) assert.ok(role.permissions.includes("assessment.view"), role.id);
});

test("observer cannot write or see audit", () => {
  const p = rbac.permissionsFor("user", "observer");
  assert.deepEqual(p.sort(), ["assessment.view", "reports.view"].sort());
  assert.equal(rbac.hasWritePermission(p), false);
});

test("evidence custodian can manage evidence but not findings", () => {
  const p = rbac.permissionsFor("user", "evidence_custodian");
  assert.ok(p.includes("evidence.manage"));
  assert.ok(!p.includes("findings.manage"));
});

test("system administrator retains full authority", () => {
  const p = rbac.permissionsFor("administrator", "observer");
  for (const permission of rbac.ALL) assert.ok(p.includes(permission), permission);
});

test("changed data roots map to granular permissions", () => {
  assert.equal(rbac.requiredPermissionForPath("evidence[EV-1].title"), "evidence.manage");
  assert.equal(rbac.requiredPermissionForPath("checklist[DCS-01].score"), "checklist.manage");
  assert.equal(rbac.requiredPermissionForPath("execNarrative"), "reports.edit");
  assert.equal(rbac.requiredPermissionForPath("objectives"), "assessment.plan.edit");
});
