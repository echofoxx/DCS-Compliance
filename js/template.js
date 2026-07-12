/* =========================================================================
 * DCS Assessment Command Center — Assessment Template Library
 *
 * This file is the reusable content core of the application. It encodes the
 * DCS Assessment Framework white paper:
 *   - 10 DCS assessment domains with default compliance weights
 *   - 55 checklist items (DCS-01 .. DCS-55) with evidence requirements,
 *     severity-if-failed, and standards mappings
 *   - Scoring rubric (0-4 maturity) and result states
 *   - Findings severity model and red-flag (critical gate) rules
 *   - Test card scenario library
 *   - Report roadmap model (30/60/90/180 day)
 *
 * Every new event instantiates its working checklist from this template,
 * which is what makes the tool reusable across events.
 * ========================================================================= */

"use strict";

const DCS_TEMPLATE = (() => {

  /* ---------------------------------------------------------------- rubric */
  const SCORE_RUBRIC = [
    { score: 0, label: "Not Observed",            meaning: "No evidence collected or capability not demonstrated." },
    { score: 1, label: "Manual / Ad Hoc",         meaning: "DCS outcome exists only through manual, informal, or inconsistent activity." },
    { score: 2, label: "Demonstrated",            meaning: "DCS outcome worked in a controlled event scenario." },
    { score: 3, label: "Integrated / Repeatable", meaning: "DCS outcome worked across systems with repeatable process and evidence." },
    { score: 4, label: "Operationally Ready",     meaning: "DCS outcome worked under realistic mission conditions with audit trail and measurable value." }
  ];

  const RESULT_STATES = [
    { id: "pass",    label: "Pass" },
    { id: "partial", label: "Partial" },
    { id: "fail",    label: "Fail" },
    { id: "no",      label: "Not Observed" },
    { id: "na",      label: "N/A" }
  ];

  const WORKFLOW_STATES = [
    { id: "not_started", label: "Not Started" },
    { id: "in_progress", label: "In Progress" },
    { id: "complete",    label: "Complete" },
    { id: "blocked",     label: "Blocked" }
  ];

  const SEVERITIES = [
    { id: "critical",    label: "Critical Gap", definition: "Unauthorized access, release of non-releasable data, policy bypass, missing audit trail for sensitive access, label loss causing release risk, or enforcement failure that defaults open." },
    { id: "major",       label: "Major Gap",    definition: "Capability works only manually, inconsistently, or outside the operational workflow; policy is not explainable; evidence is incomplete for key tests." },
    { id: "moderate",    label: "Moderate Gap", definition: "Capability works but lacks automation, scale, repeatability, resilience, or complete telemetry." },
    { id: "observation", label: "Observation",  definition: "Relevant improvement, integration issue, usability concern, or future planning item that does not block the event objective." },
    { id: "strength",    label: "Strength",     definition: "Capability, control pattern, evidence model, or operational workflow that should be preserved, reused, or scaled." }
  ];

  const EVIDENCE_TYPES = [
    "Screenshot", "Log File", "Export (CSV/JSON/XML)", "Observation Note",
    "Interview Note", "Data Sample / Metadata", "Architecture Artifact",
    "Decision Record", "Test Result", "Other"
  ];

  const EVIDENCE_QUALITY = [
    { id: "strong",   label: "Strong" },
    { id: "moderate", label: "Moderate" },
    { id: "weak",     label: "Weak" }
  ];

  const CLASSIFICATIONS = [
    "UNCLASSIFIED", "CUI", "UNCLASSIFIED//FOUO", "SECRET", "SECRET//REL", "Other / See Notes"
  ];

  /* --------------------------------------------------------------- domains */
  // Default compliance weights (sum = 100). Editable per event in Event Setup.
  const DOMAINS = [
    { id: "D01", code: "5.1",  name: "Scope, Authority & Use Cases",            short: "Scope",       weight: 4,
      focus: "Mission threads, DCS use cases, control boundaries, and compliance expectations are defined before execution." },
    { id: "D02", code: "5.2",  name: "Architecture & Control Points",           short: "Architecture", weight: 5,
      focus: "Decision points, enforcement points, identity/label sources, and telemetry paths are identified and mapped to data flows." },
    { id: "D03", code: "5.3",  name: "Asset Registration & Stewardship",        short: "Assets",      weight: 6,
      focus: "Protected assets are registered with owners, stewards, labels, mission purpose, and protection requirements." },
    { id: "D04", code: "5.4",  name: "Labeling, Tagging & Security Metadata",   short: "Labeling",    weight: 15,
      focus: "Security labels are defined, machine-readable, consistently applied, and persist as data moves." },
    { id: "D05", code: "5.5",  name: "Policy Model & Attribute Inputs",         short: "Policy",      weight: 12,
      focus: "Access and sharing policies are expressed with required user, asset, and context attributes, and are explainable." },
    { id: "D06", code: "5.6",  name: "Access Decision & Enforcement",           short: "Enforcement", weight: 15,
      focus: "Policy decisions are correct, enforced at the right control points, fail closed, and cannot be bypassed." },
    { id: "D07", code: "5.7",  name: "Sharing, Release & Partner Controls",     short: "Sharing",     weight: 10,
      focus: "Releasability and caveats are enforced: authorized partners get the releasable subset, everyone else is denied or filtered." },
    { id: "D08", code: "5.8",  name: "Protection Controls",                     short: "Protection",  weight: 8,
      focus: "Encryption, masking, redaction, DLP, rights management, and export controls protect data at rest, in transit, and in use." },
    { id: "D09", code: "5.9",  name: "Telemetry, Audit & Evidence",             short: "Audit",       weight: 15,
      focus: "Who accessed what, when, why, and under what policy can be reconstructed from exportable audit evidence." },
    { id: "D10", code: "5.10", name: "Operational Readiness & Scale",           short: "Readiness",   weight: 10,
      focus: "Controls work in the real event workflow without forcing bypass behavior, and have a path to scale beyond the event." }
  ];

  /* -------------------------------------------------- standards shorthand */
  const ZT_DATA   = "DoD ZT Data Pillar";
  const ZT_UE     = "DoD ZT User Pillar";
  const ZT_AUTO   = "DoD ZT Automation & Orchestration Pillar";
  const ZT_VA     = "DoD ZT Visibility & Analytics Pillar";
  const N207      = "NIST SP 800-207 (Zero Trust Architecture)";
  const CISA      = "CISA ZT Maturity Model v2 (Data Pillar)";
  const NSA_DATA  = "NSA CSI: Advancing ZT Maturity — Data Pillar";
  const n53 = f => `NIST SP 800-53r5 ${f}`;

  /* ------------------------------------------------------- checklist items */
  // severity: severity assigned to an auto-generated finding when the item fails.
  const CHECKLIST = [

    /* 5.1 Scope, Authority & Use Cases */
    { id: "DCS-01", domainId: "D01", severity: "major",
      requirement: "DCS event scope identifies mission threads, user communities, systems, data flows, and control boundaries.",
      question: "Is the assessment scope documented and approved before execution begins?",
      evidence: ["Approved DCS scope statement", "Event architecture", "Mission thread matrix"],
      standards: [N207, n53("PL-2"), n53("RA-3")] },
    { id: "DCS-02", domainId: "D01", severity: "major",
      requirement: "Each DCS use case identifies the mission need, protected asset, authorized users, unauthorized users, and expected protection outcome.",
      question: "Does every use case define who should and should not receive the data, and what protection outcome is expected?",
      evidence: ["DCS use case card", "Expected outcome matrix"],
      standards: [N207, ZT_DATA, n53("PL-7")] },
    { id: "DCS-03", domainId: "D01", severity: "moderate",
      requirement: "DCS assessment authority, roles, responsibilities, and escalation paths are documented.",
      question: "Do assessors know who owns each decision and how issues get escalated?",
      evidence: ["RACI", "Assessor roster", "Issue escalation process"],
      standards: [n53("PM-2"), n53("PS-7")] },
    { id: "DCS-04", domainId: "D01", severity: "major",
      requirement: "DCS compliance expectations are defined before the event, including pass, partial, fail, not observed, and not applicable criteria.",
      question: "Is the scoring rubric agreed before testing starts?",
      evidence: ["Assessment plan", "Scoring rubric"],
      standards: [n53("CA-2"), n53("PL-2")] },
    { id: "DCS-05", domainId: "D01", severity: "moderate",
      requirement: "DCS assumptions and constraints are documented, including classification environment, network restrictions, partner participation, and tool limitations.",
      question: "Are known limits recorded so findings can be interpreted correctly?",
      evidence: ["Assumption log", "Constraint register"],
      standards: [n53("PL-2"), n53("RA-3")] },

    /* 5.2 Architecture & Control Points */
    { id: "DCS-06", domainId: "D02", severity: "major",
      requirement: "DCS architecture identifies policy decision points, policy enforcement points, identity sources, attribute sources, label sources, and telemetry paths.",
      question: "Can the team point to the PDP, PEPs, and every input feeding them?",
      evidence: ["DCS architecture diagram", "Integration map"],
      standards: [N207, ZT_DATA, n53("PL-8"), n53("SA-8")] },
    { id: "DCS-07", domainId: "D02", severity: "major",
      requirement: "DCS control points are mapped to the places where data is accessed, queried, exported, transformed, shared, or moved.",
      question: "Is every data touchpoint covered by a named control point?",
      evidence: ["Control point matrix", "Data flow overlay"],
      standards: [N207, ZT_DATA, n53("AC-4")] },
    { id: "DCS-08", domainId: "D02", severity: "major",
      requirement: "DCS implementation identifies where controls are applied: application, API, gateway, file, object store, database, endpoint, or platform layer.",
      question: "Is the enforcement layer for each control explicit?",
      evidence: ["PEP placement diagram", "System owner briefing"],
      standards: [N207, n53("AC-3"), n53("SC-7")] },
    { id: "DCS-09", domainId: "D02", severity: "major",
      requirement: "DCS architecture shows how policy decisions and enforcement results are captured for audit.",
      question: "Is there a telemetry path from every PDP/PEP to an audit store?",
      evidence: ["Telemetry architecture", "Log source list"],
      standards: [ZT_VA, n53("AU-2"), n53("AU-12")] },
    { id: "DCS-10", domainId: "D02", severity: "moderate",
      requirement: "DCS dependency risks are identified, including identity, network, policy engine, catalog, label source, encryption, and logging dependencies.",
      question: "What breaks DCS if it fails, and is that documented?",
      evidence: ["Dependency map", "Risk register"],
      standards: [n53("RA-3"), n53("CP-2")] },

    /* 5.3 Asset Registration & Stewardship */
    { id: "DCS-11", domainId: "D03", severity: "major",
      requirement: "Protected DCS assets are registered with owner, steward, mission purpose, producer, consumer, system of record, and risk rating.",
      question: "Does every protected asset have an accountable owner and steward on record?",
      evidence: ["DCS asset register", "Data product record"],
      standards: [NSA_DATA, CISA, n53("CM-8"), n53("PM-5")] },
    { id: "DCS-12", domainId: "D03", severity: "major",
      requirement: "DCS asset records identify classification, releasability, handling caveats, sensitivity, mission tags, and authorized communities of interest.",
      question: "Can the register answer 'who is this releasable to' for each asset?",
      evidence: ["Asset metadata export", "Label record"],
      standards: [NSA_DATA, n53("AC-16"), n53("RA-2")] },
    { id: "DCS-13", domainId: "D03", severity: "moderate",
      requirement: "DCS asset records identify which assets require masking, redaction, filtering, encryption, rights management, or export control.",
      question: "Is the required protection profile recorded per asset?",
      evidence: ["Control mapping", "Protection profile"],
      standards: [NSA_DATA, n53("SC-28"), n53("AC-4")] },
    { id: "DCS-14", domainId: "D03", severity: "moderate",
      requirement: "DCS assets are mapped to operational use cases and decision points rather than listed as disconnected technical artifacts.",
      question: "Is each asset traceable to a mission thread?",
      evidence: ["Mission-to-asset traceability matrix"],
      standards: [ZT_DATA, n53("PM-11")] },
    { id: "DCS-15", domainId: "D03", severity: "moderate",
      requirement: "DCS steward or owner can validate whether the demonstrated use of the asset is authorized and operationally appropriate.",
      question: "Did an accountable steward confirm the demonstrated use?",
      evidence: ["Owner/steward validation note", "Hotwash record"],
      standards: [n53("PM-23"), n53("AC-1")] },

    /* 5.4 Labeling, Tagging & Security Metadata */
    { id: "DCS-16", domainId: "D04", severity: "major",
      requirement: "DCS label schema is defined before execution and includes required classification, releasability, handling, sensitivity, mission, and source metadata.",
      question: "Is there an agreed label schema all systems use?",
      evidence: ["DCS label schema", "Tagging standard"],
      standards: [NSA_DATA, n53("AC-16"), CISA] },
    { id: "DCS-17", domainId: "D04", severity: "critical",
      requirement: "DCS labels are machine-readable and available to policy decision and enforcement mechanisms.",
      question: "Can the policy engine actually read and evaluate the labels?",
      evidence: ["JSON/XML/API metadata", "Policy input sample"],
      standards: [NSA_DATA, ZT_DATA, n53("AC-16")] },
    { id: "DCS-18", domainId: "D04", severity: "major",
      requirement: "DCS labels are applied consistently to event assets before access and sharing tests are executed.",
      question: "Were assets labeled before, not during, the tests?",
      evidence: ["Sample labeled asset", "Metadata export"],
      standards: [NSA_DATA, n53("AC-16")] },
    { id: "DCS-19", domainId: "D04", severity: "critical",
      requirement: "DCS labels persist when assets move between systems, APIs, gateways, services, or partner environments.",
      question: "Do labels remain intact and machine-readable after transfer?",
      evidence: ["Before/after label comparison", "Transfer evidence"],
      standards: [NSA_DATA, ZT_DATA, n53("AC-16"), n53("AC-4")] },
    { id: "DCS-20", domainId: "D04", severity: "major",
      requirement: "DCS labels persist, transform correctly, or trigger review when assets are copied, exported, transformed, aggregated, or filtered.",
      question: "Does derivation/aggregation preserve or correctly transform protection context?",
      evidence: ["Transformation test", "Label mapping record"],
      standards: [NSA_DATA, n53("AC-16"), n53("AC-4")] },
    { id: "DCS-21", domainId: "D04", severity: "critical",
      requirement: "Missing, invalid, stale, or conflicting DCS labels trigger denial, quarantine, alert, review, or other documented handling.",
      question: "Does a bad label fail closed rather than default open?",
      evidence: ["Error log", "Workflow screenshot", "Policy result"],
      standards: [ZT_DATA, n53("SI-10"), n53("AC-3")] },

    /* 5.5 Policy Model & Attribute Inputs */
    { id: "DCS-22", domainId: "D05", severity: "major",
      requirement: "DCS policies identify required user, role, organization, nationality, clearance, mission, need-to-know, device, location, and risk attributes where applicable.",
      question: "Are all subject/context attributes the policy needs actually defined and available?",
      evidence: ["Policy attribute matrix"],
      standards: [N207, ZT_UE, n53("IA-2"), n53("AC-2")] },
    { id: "DCS-23", domainId: "D05", severity: "major",
      requirement: "DCS policies identify required asset attributes, including classification, releasability, sensitivity, mission tag, source, and handling caveat.",
      question: "Does the policy consume the asset's label set?",
      evidence: ["Policy rule set", "Metadata sample"],
      standards: [ZT_DATA, n53("AC-16"), n53("AC-3")] },
    { id: "DCS-24", domainId: "D05", severity: "critical",
      requirement: "DCS policy logic is documented in a way that assessors can understand and compare against expected outcomes.",
      question: "Can an assessor explain why a given request was allowed or denied?",
      evidence: ["Human-readable policy rules", "Reason codes"],
      standards: [N207, n53("AC-1"), n53("AU-3")] },
    { id: "DCS-25", domainId: "D05", severity: "major",
      requirement: "DCS policies distinguish between allow, deny, redact, mask, filter, watermark, alert, quarantine, and manual review outcomes.",
      question: "Is the policy action model richer than binary allow/deny where the mission needs it?",
      evidence: ["Policy action matrix"],
      standards: [ZT_DATA, n53("AC-3"), n53("AC-4")] },
    { id: "DCS-26", domainId: "D05", severity: "major",
      requirement: "DCS policy exceptions are explicitly approved, time-bound, logged, and reviewed after execution.",
      question: "Is every exception visible, bounded, and reviewed?",
      evidence: ["Exception log", "Approval record"],
      standards: [n53("CA-5"), n53("AC-1")] },

    /* 5.6 Access Decision & Enforcement */
    { id: "DCS-27", domainId: "D06", severity: "major",
      requirement: "Expected DCS access outcomes are documented before testing for authorized users, unauthorized users, mission partners, and role/device changes.",
      question: "Does an expected allow/deny matrix exist before test execution?",
      evidence: ["Expected allow/deny matrix", "Test cards"],
      standards: [n53("CA-2"), N207] },
    { id: "DCS-28", domainId: "D06", severity: "critical",
      requirement: "DCS policy decision point produces correct and explainable decisions based on identity, attribute, mission, and asset context.",
      question: "Do PDP decisions match the expected matrix, with reason codes?",
      evidence: ["PDP logs", "Policy decision output"],
      standards: [N207, ZT_DATA, n53("AC-3")] },
    { id: "DCS-29", domainId: "D06", severity: "critical",
      requirement: "DCS policy enforcement point applies the decision at the right control point without allowing bypass through alternate paths.",
      question: "Was bypass through alternate paths tested and blocked?",
      evidence: ["PEP logs", "Bypass test result"],
      standards: [N207, n53("AC-3"), n53("SC-7")] },
    { id: "DCS-30", domainId: "D06", severity: "major",
      requirement: "Authorized users receive the data or service needed for the mission without unnecessary delay or manual override.",
      question: "Do authorized users succeed without workarounds (false-deny check)?",
      evidence: ["Successful access evidence", "Timing data"],
      standards: [ZT_UE, n53("AC-2")] },
    { id: "DCS-31", domainId: "D06", severity: "critical",
      requirement: "Unauthorized users are denied, masked, filtered, or redirected in accordance with policy.",
      question: "Were all unauthorized attempts stopped (false-allow check)?",
      evidence: ["Denial logs", "Screenshot", "Policy result"],
      standards: [N207, n53("AC-3"), n53("AC-6")] },
    { id: "DCS-32", domainId: "D06", severity: "major",
      requirement: "Access revocation or policy change takes effect within an assessed timeframe after role, mission, device, or risk posture changes.",
      question: "How fast does a policy/attribute change actually remove access?",
      evidence: ["Revocation test", "Latency metric"],
      standards: [N207, ZT_AUTO, n53("AC-2(13)")] },
    { id: "DCS-33", domainId: "D06", severity: "critical",
      requirement: "DCS enforcement failures fail closed or trigger a documented review path rather than silently allowing access.",
      question: "When enforcement breaks, does the system default deny?",
      evidence: ["Failure-mode test", "Incident note"],
      standards: [n53("SC-24"), n53("AC-3")] },

    /* 5.7 Sharing, Release & Partner Controls */
    { id: "DCS-34", domainId: "D07", severity: "major",
      requirement: "DCS sharing rules are mapped to releasability, mission partner, coalition, bilateral, or community-of-interest constraints.",
      question: "Are REL TO / COI constraints expressed as enforceable rules?",
      evidence: ["Sharing rule matrix", "Release policy"],
      standards: [ZT_DATA, n53("AC-21"), n53("AC-4")] },
    { id: "DCS-35", domainId: "D07", severity: "major",
      requirement: "Authorized mission partners can access the releasable subset needed for the mission.",
      question: "Did the partner actually get the releasable data they needed?",
      evidence: ["Partner access test", "Successful transaction evidence"],
      standards: [n53("AC-21"), ZT_DATA] },
    { id: "DCS-36", domainId: "D07", severity: "critical",
      requirement: "Unauthorized mission partners are denied, filtered, redacted, masked, or restricted from non-releasable information.",
      question: "Was over-sharing to unauthorized partners blocked?",
      evidence: ["Blocked access evidence", "Filtering result"],
      standards: [n53("AC-4"), n53("AC-21"), ZT_DATA] },
    { id: "DCS-37", domainId: "D07", severity: "critical",
      requirement: "DCS controls preserve labels and metadata after partner sharing or cross-domain movement within the event scope.",
      question: "Does protection context survive the partner/cross-domain hop?",
      evidence: ["Before/after evidence", "Metadata validation"],
      standards: [NSA_DATA, n53("AC-16"), n53("AC-4")] },
    { id: "DCS-38", domainId: "D07", severity: "major",
      requirement: "DCS sharing does not rely on unmanaged manual workarounds such as screenshots, email forwarding, untracked exports, or local file copies.",
      question: "Is the managed sharing path the path operators actually use?",
      evidence: ["Operator observation", "Workflow review"],
      standards: [CISA, n53("AC-21")] },
    { id: "DCS-39", domainId: "D07", severity: "critical",
      requirement: "DCS sharing outcomes are traceable to policy and can be reconstructed after the event.",
      question: "Can every share be traced to the policy decision that authorized it?",
      evidence: ["Audit trail", "Policy decision correlation"],
      standards: [n53("AU-6"), n53("AU-12"), ZT_VA] },

    /* 5.8 Protection Controls */
    { id: "DCS-40", domainId: "D08", severity: "major",
      requirement: "DCS controls protect assets at rest, in transit, and during approved access or use where applicable.",
      question: "Is data encrypted / session-controlled across its lifecycle?",
      evidence: ["Encryption, TLS, rights management, or session-control evidence"],
      standards: [n53("SC-8"), n53("SC-28"), NSA_DATA] },
    { id: "DCS-41", domainId: "D08", severity: "major",
      requirement: "DCS controls can mask, redact, tokenize, minimize, watermark, or filter sensitive elements based on policy.",
      question: "Can protection be applied at the field level, not just the object level?",
      evidence: ["Masking/redaction/filtering test"],
      standards: [NSA_DATA, n53("AC-4"), n53("SI-19")] },
    { id: "DCS-42", domainId: "D08", severity: "critical",
      requirement: "DCS controls restrict unauthorized bulk export, copy, print, download, or uncontrolled redistribution.",
      question: "Was a bulk export / mass copy attempt controlled?",
      evidence: ["Export-control test", "DLP alert"],
      standards: [n53("AC-4"), n53("SC-7(10)"), NSA_DATA] },
    { id: "DCS-43", domainId: "D08", severity: "critical",
      requirement: "DCS controls detect or block attempted exfiltration or unauthorized movement within the event scenario.",
      question: "Does monitoring catch data moving where it should not?",
      evidence: ["DLP/monitoring evidence", "Blocked transfer"],
      standards: [n53("SI-4"), n53("AU-13"), ZT_VA] },
    { id: "DCS-44", domainId: "D08", severity: "moderate",
      requirement: "DCS controls account for lifecycle needs such as retention, deletion, declassification, release review, and end-of-event disposition.",
      question: "Is there a plan for the data after the event ends?",
      evidence: ["Lifecycle policy", "Disposition plan"],
      standards: [n53("SI-12"), n53("MP-6")] },

    /* 5.9 Telemetry, Audit & Evidence */
    { id: "DCS-45", domainId: "D09", severity: "critical",
      requirement: "DCS audit logs capture user, device, asset, action, label, policy, decision, enforcement point, timestamp, and result.",
      question: "Do log records carry the full decision context?",
      evidence: ["Audit log sample"],
      standards: [n53("AU-3"), n53("AU-12"), ZT_VA] },
    { id: "DCS-46", domainId: "D09", severity: "critical",
      requirement: "DCS logs capture both successful and denied access attempts.",
      question: "Are denials logged as faithfully as allows?",
      evidence: ["Allow/deny log export"],
      standards: [n53("AU-2"), n53("AC-7")] },
    { id: "DCS-47", domainId: "D09", severity: "major",
      requirement: "DCS logs capture data movement, sharing, export, transformation, label change, and administrative change events.",
      question: "Is movement and admin activity auditable, not just access?",
      evidence: ["Movement log", "Admin audit log"],
      standards: [n53("AU-2"), n53("AU-6"), n53("CM-5")] },
    { id: "DCS-48", domainId: "D09", severity: "major",
      requirement: "DCS alerts identify suspicious behavior, policy violations, label failures, or unauthorized sharing attempts.",
      question: "Do violations surface as alerts a human will actually see?",
      evidence: ["SIEM/dashboard alert", "Notification evidence"],
      standards: [n53("SI-4"), n53("AU-6"), ZT_VA] },
    { id: "DCS-49", domainId: "D09", severity: "critical",
      requirement: "DCS evidence is exportable and sufficient for independent post-event reconstruction.",
      question: "Could an independent analyst rebuild the event timeline from the exports?",
      evidence: ["CSV/JSON export", "Evidence package"],
      standards: [n53("AU-7"), n53("AU-9")] },
    { id: "DCS-50", domainId: "D09", severity: "major",
      requirement: "DCS event evidence supports expected versus actual analysis for every test card.",
      question: "Does every test card have linked evidence for its outcome?",
      evidence: ["Completed test card", "Evidence traceability"],
      standards: [n53("CA-2"), n53("AU-6")] },

    /* 5.10 Operational Readiness & Scale */
    { id: "DCS-51", domainId: "D10", severity: "major",
      requirement: "DCS controls are usable by operators and do not force mission users into unmanaged bypass behavior.",
      question: "Do operators use the controlled path because it works, not because they must?",
      evidence: ["User feedback", "Observation notes"],
      standards: [CISA, n53("PL-4")] },
    { id: "DCS-52", domainId: "D10", severity: "moderate",
      requirement: "DCS denial, masking, or filtering results are understandable enough for operators and assessors to act on them.",
      question: "When access is denied, does the operator know why and what to do next?",
      evidence: ["User interface screenshot", "Reason code"],
      standards: [n53("AC-8"), N207] },
    { id: "DCS-53", domainId: "D10", severity: "moderate",
      requirement: "DCS latency, availability, and reliability are measured during execution.",
      question: "Are decision/enforcement latency and uptime actually measured?",
      evidence: ["Latency and uptime metrics"],
      standards: [n53("SC-5"), n53("CP-2")] },
    { id: "DCS-54", domainId: "D10", severity: "moderate",
      requirement: "DCS behavior under degraded network, disconnected, or limited-connectivity conditions is tested or explicitly documented as a limitation.",
      question: "What happens to policy decisions when the network degrades?",
      evidence: ["Degraded comms test", "Limitation note"],
      standards: [n53("CP-8"), n53("SC-24")] },
    { id: "DCS-55", domainId: "D10", severity: "moderate",
      requirement: "DCS capability has a clear path to scale beyond the event, including governance, integration, operational support, and sustainment needs.",
      question: "Is there a credible roadmap from demonstration to operations?",
      evidence: ["Gap list", "Roadmap", "Sustainment estimate"],
      standards: [n53("PM-3"), n53("SA-2")] }
  ];

  /* ------------------------------------------------- test card library */
  // Reusable scenario patterns. "checklistIds" pre-links the cards to the
  // checklist items each scenario provides evidence for.
  const TEST_CARD_LIBRARY = [
    { title: "Authorized user accesses protected mission data",
      dcsUseCase: "Dynamic access control",
      scenario: "A U.S. operator with valid mission role, clearance, and device posture requests a protected data product through the primary interface.",
      accessAction: "read", expectedOutcome: "allow",
      proves: "Allow policy works; authorized access succeeds without workaround.",
      checklistIds: ["DCS-28", "DCS-30"] },
    { title: "Unauthorized partner requests restricted data",
      dcsUseCase: "Partner release control",
      scenario: "A coalition partner without releasability for the asset requests the full (non-releasable) data product.",
      accessAction: "read", expectedOutcome: "deny",
      proves: "Denial works; false-allow rate stays at zero.",
      checklistIds: ["DCS-31", "DCS-36"] },
    { title: "Authorized partner receives releasable subset",
      dcsUseCase: "Partner release control",
      scenario: "An authorized coalition partner requests the mission data product; policy should filter/redact to the REL TO subset.",
      accessAction: "share", expectedOutcome: "redact",
      proves: "Releasable-subset sharing works end to end.",
      checklistIds: ["DCS-34", "DCS-35", "DCS-41"] },
    { title: "Label persistence through API gateway transfer",
      dcsUseCase: "Label persistence",
      scenario: "A labeled asset moves from the source system through the API gateway to a consumer system. Compare label set before and after.",
      accessAction: "transform", expectedOutcome: "allow",
      proves: "Protection context travels with the data.",
      checklistIds: ["DCS-19", "DCS-20", "DCS-37"] },
    { title: "Role change revokes access mid-event",
      dcsUseCase: "Dynamic authorization / revocation",
      scenario: "A user with active access has their mission role removed. Re-attempt access and measure time to revocation.",
      accessAction: "read", expectedOutcome: "deny",
      proves: "Dynamic authorization works; revocation latency is measured.",
      checklistIds: ["DCS-32"] },
    { title: "Bulk export attempt is controlled",
      dcsUseCase: "Export / DLP control",
      scenario: "A user attempts a bulk export or mass download of protected records outside approved workflow.",
      accessAction: "export", expectedOutcome: "deny",
      proves: "DLP / export control works and alerts fire.",
      checklistIds: ["DCS-42", "DCS-43", "DCS-48"] },
    { title: "Unlabeled asset fails closed",
      dcsUseCase: "Label integrity handling",
      scenario: "An asset with a missing or invalid label set is requested. Policy should deny, quarantine, or route to review — not default open.",
      accessAction: "read", expectedOutcome: "quarantine",
      proves: "Bad labels fail closed.",
      checklistIds: ["DCS-21", "DCS-33"] },
    { title: "Enforcement bypass attempt via alternate path",
      dcsUseCase: "Enforcement coverage",
      scenario: "Request the same protected asset through a secondary path (direct DB query, alternate API, file share) that skips the primary interface.",
      accessAction: "query", expectedOutcome: "deny",
      proves: "Enforcement exists at the data, not just the front door.",
      checklistIds: ["DCS-29"] },
    { title: "Audit reconstruction exercise",
      dcsUseCase: "Audit & evidence",
      scenario: "Pick one hour of event activity and rebuild who accessed what, when, why, and under what policy using only exported logs.",
      accessAction: "audit", expectedOutcome: "allow",
      proves: "Evidence is complete enough for independent reconstruction.",
      checklistIds: ["DCS-45", "DCS-46", "DCS-49"] },
    { title: "Degraded-network access behavior",
      dcsUseCase: "Operational resilience",
      scenario: "Introduce constrained/disconnected network conditions and observe whether policy decisions fail closed, cache safely, or block the mission.",
      accessAction: "read", expectedOutcome: "review",
      proves: "Behavior under degraded comms is known, not assumed.",
      checklistIds: ["DCS-54", "DCS-33"] }
  ];

  const OUTCOME_ACTIONS = ["allow", "deny", "redact", "mask", "filter", "watermark", "alert", "quarantine", "review"];
  const ACCESS_ACTIONS  = ["read", "query", "write", "share", "export", "transform", "download", "print", "copy", "aggregate", "release", "audit"];

  /* --------------------------------------------------------- red flags */
  // Conditions that cap the overall rating regardless of weighted score.
  const RED_FLAGS = [
    { id: "false_allow",     label: "Unauthorized access allowed (false allow)",           itemIds: ["DCS-31", "DCS-36"] },
    { id: "label_loss",      label: "Required label lost during movement or transform",     itemIds: ["DCS-19", "DCS-37"] },
    { id: "no_audit",        label: "Policy or enforcement not logged / no audit evidence", itemIds: ["DCS-45", "DCS-46", "DCS-49"] },
    { id: "unexplainable",   label: "Policy decision cannot be explained",                  itemIds: ["DCS-24", "DCS-28"] },
    { id: "bypass",          label: "Enforcement point bypassed via alternate path",        itemIds: ["DCS-29"] },
    { id: "fails_open",      label: "Enforcement failure defaults open",                    itemIds: ["DCS-21", "DCS-33"] }
  ];

  /* ---------------------------------------------------------- roadmap */
  const ROADMAP = [
    { horizon: "30 Days",  actions: "Finalize DCS scope, use case matrix, protected asset register, label schema, policy expectation matrix, and evidence plan." },
    { horizon: "60 Days",  actions: "Validate DCS test cards, log sources, policy rules, control points, and partner-sharing scenarios." },
    { horizon: "90 Days",  actions: "Complete on-site execution, hotwash, evidence validation, preliminary scoring, and critical gap escalation." },
    { horizon: "180 Days", actions: "Publish final assessment report, identify reusable DCS control patterns, and recommend scalable implementation roadmap." }
  ];

  const EXECUTION_MODEL = [
    { day: "Day 0", focus: "Setup and alignment",          activities: "Confirm access, POCs, schedule, DCS test cards, evidence folders, log sources, and hotwash process." },
    { day: "Day 1", focus: "Baseline DCS architecture",    activities: "Validate systems, DCS control points, policy sources, label sources, identity/attribute feeds, and telemetry paths." },
    { day: "Day 2", focus: "Labeling and policy inputs",   activities: "Assess DCS labels, metadata, machine readability, attribute availability, and policy-rule traceability." },
    { day: "Day 3", focus: "Decision and enforcement",     activities: "Execute allow, deny, mask, redact, filter, revocation, and bypass tests." },
    { day: "Day 4", focus: "Sharing and operational stress", activities: "Assess partner release, non-release denial, label persistence, degraded comms, latency, and workaround behavior." },
    { day: "Day 5", focus: "Evidence review and hotwash",  activities: "Close evidence gaps, validate findings with operators, identify critical gaps, and prepare leadership snapshot." }
  ];

  // Event lifecycle phases (white paper §3 assessment approach)
  const PHASES = [
    { id: "planning",  label: "Phase 1 · Scope & Planning",    hint: "Define DCS use cases, mission threads, systems, data assets, control points, and expected access outcomes." },
    { id: "design",    label: "Phase 2 · Assessment Design",   hint: "Build the assessment plan, test cards, DCS compliance checklist, metrics, and evidence capture schema." },
    { id: "execution", label: "Phase 3 · On-Site Execution",   hint: "Observe DCS controls in operation, execute targeted tests, collect evidence, and validate findings with operators." },
    { id: "analysis",  label: "Phase 4 · Analysis & Reporting", hint: "Compare expected versus actual outcomes and produce final DCS readiness findings and recommendations." },
    { id: "complete",  label: "Complete / Archived",           hint: "Final report delivered. Event retained for cross-event comparison." }
  ];

  const APP_ROLES = [
    "Assessment Lead", "DCS Control Assessor", "Mission Thread Lead", "Data Steward",
    "Cyber/ZT SME", "Partner / Coalition SME", "Leadership Viewer"
  ];

  const STANDARDS_OPTIONS = [
    "DoD Zero Trust Strategy & Roadmap", "NIST SP 800-207 (Zero Trust Architecture)",
    "NIST SP 800-53 Rev. 5", "CISA ZT Maturity Model v2",
    "NSA CSI: ZT Data Pillar", "DoD Data Strategy (2020)"
  ];

  return {
    SCORE_RUBRIC, RESULT_STATES, WORKFLOW_STATES, SEVERITIES,
    EVIDENCE_TYPES, EVIDENCE_QUALITY, CLASSIFICATIONS,
    DOMAINS, CHECKLIST, TEST_CARD_LIBRARY,
    OUTCOME_ACTIONS, ACCESS_ACTIONS, RED_FLAGS,
    ROADMAP, EXECUTION_MODEL, PHASES, APP_ROLES, STANDARDS_OPTIONS
  };
})();
