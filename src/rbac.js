"use strict";

const ALL = [
  "assessment.view", "assessment.create", "assessment.delete", "assessment.plan.edit",
  "assessment.team.manage", "checklist.manage", "test.manage", "evidence.manage",
  "findings.manage", "reports.view", "reports.edit", "assessment.review",
  "assessment.approve", "audit.view", "users.manage"
];

const ROLE_DEFINITIONS = [
  { id: "assessment_program_manager", name: "Assessment Program Manager", description: "Owns the assessment program, event portfolio, staffing, approvals, and delivery.", permissions: ALL.filter((p) => p !== "users.manage") },
  { id: "assessment_lead", name: "Assessment Lead", description: "Leads one assessment from scope through final report and manages the assessment team.", permissions: ALL.filter((p) => !["users.manage", "assessment.create"].includes(p)) },
  { id: "lead_assessor", name: "Lead Assessor", description: "Coordinates assessors, scoring, evidence sufficiency, findings, and report development.", permissions: ["assessment.view", "assessment.plan.edit", "checklist.manage", "test.manage", "evidence.manage", "findings.manage", "reports.view", "reports.edit", "assessment.review", "audit.view"] },
  { id: "dcs_control_assessor", name: "DCS Control Assessor", description: "Executes DCS checklist checks, test cards, evidence capture, scoring, and draft findings.", permissions: ["assessment.view", "checklist.manage", "test.manage", "evidence.manage", "findings.manage", "reports.view"] },
  { id: "security_assessor", name: "Security / Zero Trust Assessor", description: "Assesses policy decision, enforcement, identity, device, network, and monitoring behavior.", permissions: ["assessment.view", "checklist.manage", "test.manage", "evidence.manage", "findings.manage", "reports.view"] },
  { id: "test_director", name: "Test Director", description: "Plans and controls test execution, expected outcomes, instrumentation, and hotwash records.", permissions: ["assessment.view", "assessment.plan.edit", "test.manage", "evidence.manage", "findings.manage", "reports.view"] },
  { id: "evidence_custodian", name: "Evidence Custodian", description: "Maintains evidence intake, provenance, quality, classification, and chain of custody.", permissions: ["assessment.view", "evidence.manage", "reports.view", "audit.view"] },
  { id: "data_steward", name: "Data Steward / Data Product Owner", description: "Defines protected data objects, metadata, labels, sharing rules, and supporting evidence.", permissions: ["assessment.view", "assessment.plan.edit", "checklist.manage", "evidence.manage", "reports.view"] },
  { id: "technical_sme", name: "Technical SME / System Integrator", description: "Provides system context, supports tests, submits evidence, and responds to findings.", permissions: ["assessment.view", "test.manage", "evidence.manage", "reports.view"] },
  { id: "mission_owner", name: "Mission Owner / Operational Representative", description: "Defines mission threads, validates mission impact, and reviews results.", permissions: ["assessment.view", "assessment.plan.edit", "reports.view", "assessment.review"] },
  { id: "event_coordinator", name: "Event Coordinator / Site Lead", description: "Maintains event logistics, participants, systems, schedules, and daily activity records.", permissions: ["assessment.view", "assessment.plan.edit", "assessment.team.manage", "reports.view"] },
  { id: "reviewer_approver", name: "Independent Reviewer / Approving Official", description: "Reviews evidence and findings, records approval decisions, and views the audit trail.", permissions: ["assessment.view", "reports.view", "assessment.review", "assessment.approve", "audit.view"] },
  { id: "observer", name: "Observer / Read Only", description: "Can view assigned assessments and reports without changing records.", permissions: ["assessment.view", "reports.view"] }
];

const SYSTEM_PERMISSIONS = {
  administrator: ALL,
  program_manager: ["assessment.view", "assessment.create", "reports.view"],
  user: []
};

const CHANGE_PERMISSIONS = {
  checklist: "checklist.manage",
  testCards: "test.manage",
  evidence: "evidence.manage",
  findings: "findings.manage",
  missionThreads: "assessment.plan.edit",
  assets: "assessment.plan.edit",
  participants: "assessment.plan.edit",
  systems: "assessment.plan.edit",
  dailyLogs: "assessment.plan.edit",
  domainWeights: "assessment.plan.edit",
  execNarrative: "reports.edit"
};

const PLAN_FIELDS = new Set(["name", "location", "eventWindow", "assessmentPeriod", "description", "objectives", "classification", "phase", "standards", "isSample"]);

function unique(values) { return [...new Set(values)]; }
function systemPermissions(role) { return SYSTEM_PERMISSIONS[role] || []; }
function permissionsFor(systemRole, assessmentRole) {
  const role = ROLE_DEFINITIONS.find((item) => item.id === assessmentRole);
  return unique([...systemPermissions(systemRole), ...(role ? role.permissions : [])]);
}
function can(user, permission, assessmentRole) {
  return permissionsFor(user.system_role, assessmentRole).includes(permission);
}
function requiredPermissionForPath(path) {
  const root = String(path || "").split(/[.[\]]/).filter(Boolean)[0];
  if (CHANGE_PERMISSIONS[root]) return CHANGE_PERMISSIONS[root];
  if (PLAN_FIELDS.has(root)) return "assessment.plan.edit";
  return "assessment.plan.edit";
}
function hasWritePermission(permissions) {
  return permissions.some((p) => p.endsWith(".manage") || p.endsWith(".edit") || p === "assessment.delete" || p === "assessment.approve");
}

module.exports = { ALL, ROLE_DEFINITIONS, SYSTEM_PERMISSIONS, permissionsFor, systemPermissions, can, requiredPermissionForPath, hasWritePermission };
