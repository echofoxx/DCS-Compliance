"use strict";

const path = require("path");
const crypto = require("crypto");
const express = require("express");
const helmet = require("helmet");
const compression = require("compression");
const cookieParser = require("cookie-parser");
const { rateLimit } = require("express-rate-limit");
const config = require("./config");
const { pool, workspaceRevision, bumpWorkspaceRevision } = require("./db");
const security = require("./security");
const rbac = require("./rbac");
const { changedPaths, stampAttribution, writeAudit, compactSnapshot, auditExcerpt } = require("./audit");

const app = express();
if (config.trustProxy) app.set("trust proxy", config.trustProxy);
app.disable("x-powered-by");
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"], connectSrc: ["'self'", "http:", "https:"],
      objectSrc: ["'none'"], baseUri: ["'self'"], frameAncestors: ["'none'"]
    }
  },
  crossOriginEmbedderPolicy: false
}));
app.use(compression());
app.use(cookieParser());
app.use(express.json({ limit: `${config.maxBodyMb}mb` }));
app.use(security.authenticate);

const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 12, standardHeaders: "draft-8", legacyHeaders: false });

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}
function text(value, max = 500) { return String(value == null ? "" : value).trim().slice(0, max); }
function usernameValid(value) { return /^[a-z0-9][a-z0-9._-]{2,63}$/.test(value); }
function publicRole(row) { return { id: row.id, name: row.name, description: row.description, permissions: row.permissions }; }
function actor(user) { return { id: user.id, username: user.username, display_name: user.display_name }; }

async function recordAudit(payload, work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (work) await work(client);
    await writeAudit(client, payload);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

async function assessmentRole(userId, assessmentId, client = pool) {
  const result = await client.query("SELECT role_id FROM assessment_members WHERE user_id=$1 AND assessment_id=$2", [userId, assessmentId]);
  return result.rows[0]?.role_id || null;
}
async function requireAssessmentPermission(req, res, permission) {
  const roleId = await assessmentRole(req.user.id, req.params.assessmentId);
  if (!rbac.can(req.user, permission, roleId)) {
    res.status(403).json({ error: "You do not have permission for this assessment.", code: "FORBIDDEN" });
    return null;
  }
  return roleId || "system";
}

/* --------------------------------------------------------------- health */
app.get("/api/health", asyncRoute(async (_req, res) => {
  await pool.query("SELECT 1");
  res.json({ ok: true, app: "dcs-assessment-command-center", version: config.appVersion, database: "ready" });
}));

/* ---------------------------------------------------------------- auth */
app.post("/api/auth/login", loginLimiter, asyncRoute(async (req, res) => {
  const username = security.normalizeUsername(req.body?.username);
  const password = String(req.body?.password || "");
  const result = await pool.query("SELECT * FROM users WHERE username=$1", [username]);
  const user = result.rows[0];
  const generic = { error: "Invalid username or password.", code: "LOGIN_FAILED" };
  if (!user || user.status !== "active") return res.status(401).json(generic);
  if (user.locked_until && new Date(user.locked_until) > new Date()) {
    return res.status(423).json({ error: "Account temporarily locked. Try again later.", code: "ACCOUNT_LOCKED" });
  }
  if (!(await security.verifyPassword(user, password))) {
    const failures = Number(user.failed_login_count || 0) + 1;
    await pool.query(
      `UPDATE users SET failed_login_count=$2, locked_until=CASE WHEN $2>=8 THEN NOW()+INTERVAL '15 minutes' ELSE NULL END WHERE id=$1`,
      [user.id, failures]
    );
    return res.status(401).json(generic);
  }
  await pool.query("UPDATE users SET failed_login_count=0,locked_until=NULL,last_login_at=NOW() WHERE id=$1", [user.id]);
  const csrfToken = await security.createSession(user, req, res);
  await recordAudit({ actor: actor(user), action: "auth.login", entityType: "session", entityId: null, metadata: { ip: req.ip } });
  res.json({ user: security.publicUser(user), csrfToken, globalPermissions: rbac.systemPermissions(user.system_role), features: { seedSampleData: config.allowSampleData } });
}));

app.get("/api/auth/session", security.requireAuth, (req, res) => {
  res.json({ user: security.publicUser(req.user), csrfToken: req.csrfToken, globalPermissions: rbac.systemPermissions(req.user.system_role), features: { seedSampleData: config.allowSampleData } });
});

app.post("/api/auth/logout", security.requireAuth, security.requireCsrf, asyncRoute(async (req, res) => {
  const user = req.user;
  await security.destroySession(req, res);
  await recordAudit({ actor: actor(user), action: "auth.logout", entityType: "session" });
  res.json({ ok: true });
}));

app.post("/api/auth/change-password", security.requireAuth, security.requireCsrf, asyncRoute(async (req, res) => {
  const currentPassword = String(req.body?.currentPassword || "");
  const newPassword = String(req.body?.newPassword || "");
  const found = await pool.query("SELECT * FROM users WHERE id=$1", [req.user.id]);
  const user = found.rows[0];
  if (!(await security.verifyPassword(user, currentPassword))) return res.status(400).json({ error: "Current password is incorrect." });
  const errors = security.validatePassword(newPassword, user.username);
  if (errors.length) return res.status(400).json({ error: errors.join(" "), validationErrors: errors });
  const passwordHash = await security.hashPassword(newPassword);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE users SET password_hash=$2,force_password_change=FALSE,updated_at=NOW() WHERE id=$1", [user.id, passwordHash]);
    await client.query("DELETE FROM sessions WHERE user_id=$1 AND token_hash<>$2", [user.id, crypto.createHash("sha256").update(req.cookies[security.COOKIE]).digest("hex")]);
    await writeAudit(client, { actor: actor(user), action: "user.password_changed", entityType: "user", entityId: user.id });
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
  res.json({ ok: true });
}));

/* ----------------------------------------------------------- shared API */
app.use("/api", security.requireAuth);
app.use("/api", security.requireCsrf);

app.get("/api/roles", asyncRoute(async (_req, res) => {
  const result = await pool.query("SELECT id,name,description,permissions FROM roles ORDER BY name");
  res.json({ roles: result.rows.map(publicRole) });
}));

app.get("/api/revision", asyncRoute(async (_req, res) => res.json({ revision: await workspaceRevision() })));

app.get("/api/workspace", asyncRoute(async (req, res) => {
  const globalView = rbac.systemPermissions(req.user.system_role).includes("assessment.view");
  const result = await pool.query(
    globalView
      ? `SELECT a.*,m.role_id FROM assessments a LEFT JOIN assessment_members m ON m.assessment_id=a.id AND m.user_id=$1 WHERE a.deleted_at IS NULL ORDER BY a.updated_at DESC`
      : `SELECT a.*,m.role_id FROM assessments a JOIN assessment_members m ON m.assessment_id=a.id AND m.user_id=$1 WHERE a.deleted_at IS NULL ORDER BY a.updated_at DESC`,
    [req.user.id]
  );
  const events = result.rows.map((row) => row.state);
  const access = Object.fromEntries(result.rows.map((row) => {
    const permissions = rbac.permissionsFor(req.user.system_role, row.role_id);
    return [row.id, { roleId: row.role_id || (req.user.system_role === "administrator" ? "system_administrator" : "program_manager"), permissions, canWrite: rbac.hasWritePermission(permissions), revision: row.revision }];
  }));
  const revision = await workspaceRevision();
  res.json({ revision, state: { version: 2, activeEventId: events[0]?.id || null, events, settings: { theme: "auto" } }, access, savedAt: result.rows[0]?.updated_at || null });
}));

app.put("/api/workspace", asyncRoute(async (req, res) => {
  if (req.user.force_password_change) return res.status(403).json({ error: "Change the bootstrap password before editing assessment data.", code: "PASSWORD_CHANGE_REQUIRED" });
  const body = req.body;
  if (!body || !Number.isInteger(body.revision) || !body.state || !Array.isArray(body.state.events)) {
    return res.status(400).json({ error: "Expected {revision,state:{events:[]}}." });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const currentRevision = await workspaceRevision(client);
    if (body.revision !== currentRevision) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "Workspace changed; reload and reapply the edit.", revision: currentRevision, code: "REVISION_CONFLICT" });
    }
    const globalView = rbac.systemPermissions(req.user.system_role).includes("assessment.view");
    const existingResult = await client.query(
      globalView
        ? `SELECT a.*,m.role_id FROM assessments a LEFT JOIN assessment_members m ON m.assessment_id=a.id AND m.user_id=$1 WHERE a.deleted_at IS NULL FOR UPDATE OF a`
        : `SELECT a.*,m.role_id FROM assessments a JOIN assessment_members m ON m.assessment_id=a.id AND m.user_id=$1 WHERE a.deleted_at IS NULL FOR UPDATE OF a`,
      [req.user.id]
    );
    const existing = new Map(existingResult.rows.map((row) => [row.id, row]));
    const submitted = new Map();
    for (const rawEvent of body.state.events) {
      if (!rawEvent || typeof rawEvent !== "object" || !/^[A-Za-z0-9_.:-]{3,120}$/.test(String(rawEvent.id || ""))) {
        throw Object.assign(new Error("Every assessment needs a valid stable id."), { status: 400 });
      }
      if (submitted.has(rawEvent.id)) throw Object.assign(new Error("Duplicate assessment id."), { status: 400 });
      submitted.set(rawEvent.id, rawEvent);
    }
    let changed = false;
    for (const [id, rawEvent] of submitted) {
      const old = existing.get(id);
      if (!old) {
        if (!rbac.systemPermissions(req.user.system_role).includes("assessment.create")) throw Object.assign(new Error("You cannot create assessments."), { status: 403 });
        const stamped = stampAttribution(rawEvent, null, req.user);
        await client.query(
          `INSERT INTO assessments(id,name,classification,phase,state,revision,created_by,updated_by) VALUES($1,$2,$3,$4,$5::jsonb,1,$6,$6)`,
          [id, text(stamped.name, 240) || "Untitled Assessment", text(stamped.classification, 80) || "UNCLASSIFIED", text(stamped.phase, 40) || "planning", JSON.stringify(stamped), req.user.id]
        );
        const defaultRole = req.user.system_role === "program_manager" ? "assessment_program_manager" : "assessment_lead";
        await client.query("INSERT INTO assessment_members(assessment_id,user_id,role_id,assigned_by) VALUES($1,$2,$3,$2)", [id, req.user.id, defaultRole]);
        await writeAudit(client, { assessmentId: id, actor: actor(req.user), action: "assessment.created", entityType: "assessment", entityId: id, paths: ["root"], after: compactSnapshot(stamped) });
        changed = true;
        continue;
      }
      const paths = changedPaths(old.state, rawEvent);
      if (!paths.length) continue;
      const permissions = rbac.permissionsFor(req.user.system_role, old.role_id);
      const required = [...new Set(paths.map(rbac.requiredPermissionForPath))];
      const missing = required.filter((permission) => !permissions.includes(permission));
      if (missing.length) throw Object.assign(new Error(`Your role cannot change: ${missing.join(", ")}.`), { status: 403, code: "INSUFFICIENT_ASSESSMENT_ROLE" });
      const stamped = stampAttribution(rawEvent, old.state, req.user);
      await client.query(
        `UPDATE assessments SET name=$2,classification=$3,phase=$4,state=$5::jsonb,revision=revision+1,updated_by=$6,updated_at=NOW() WHERE id=$1`,
        [id, text(stamped.name, 240) || "Untitled Assessment", text(stamped.classification, 80) || "UNCLASSIFIED", text(stamped.phase, 40) || "planning", JSON.stringify(stamped), req.user.id]
      );
      await writeAudit(client, { assessmentId: id, actor: actor(req.user), action: "assessment.updated", entityType: "assessment", entityId: id, paths, before: auditExcerpt(old.state, paths), after: auditExcerpt(stamped, paths), metadata: { requiredPermissions: required } });
      changed = true;
    }
    for (const [id, old] of existing) {
      if (submitted.has(id)) continue;
      const permissions = rbac.permissionsFor(req.user.system_role, old.role_id);
      if (!permissions.includes("assessment.delete")) throw Object.assign(new Error(`You cannot delete assessment ${old.name}.`), { status: 403 });
      await client.query("UPDATE assessments SET deleted_at=NOW(),deleted_by=$2,updated_by=$2,updated_at=NOW() WHERE id=$1", [id, req.user.id]);
      await writeAudit(client, { assessmentId: id, actor: actor(req.user), action: "assessment.archived", entityType: "assessment", entityId: id, paths: ["deleted_at"], before: compactSnapshot(old.state) });
      changed = true;
    }
    const revision = changed ? await bumpWorkspaceRevision(client) : currentRevision;
    await client.query("COMMIT");
    res.json({ revision, savedAt: new Date().toISOString() });
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch (_) {}
    if (error.status) return res.status(error.status).json({ error: error.message, code: error.code || "REQUEST_REJECTED" });
    throw error;
  } finally { client.release(); }
}));

/* ------------------------------------------------------------ users admin */
function requireGlobal(permission) {
  return (req, res, next) => rbac.systemPermissions(req.user.system_role).includes(permission)
    ? next() : res.status(403).json({ error: "Administrator permission required.", code: "FORBIDDEN" });
}

app.get("/api/admin/users", requireGlobal("users.manage"), asyncRoute(async (_req, res) => {
  const result = await pool.query(`SELECT id,username,display_name,email,organization,title,system_role,status,force_password_change,last_login_at,created_at,updated_at FROM users ORDER BY display_name,username`);
  res.json({ users: result.rows.map(security.publicUser) });
}));

app.post("/api/admin/users", requireGlobal("users.manage"), asyncRoute(async (req, res) => {
  const username = security.normalizeUsername(req.body?.username);
  const password = String(req.body?.temporaryPassword || "");
  const displayName = text(req.body?.displayName, 160);
  const systemRole = ["administrator", "program_manager", "user"].includes(req.body?.systemRole) ? req.body.systemRole : "user";
  if (!usernameValid(username)) return res.status(400).json({ error: "Username must be 3–64 lowercase letters, numbers, dots, dashes, or underscores." });
  if (!displayName) return res.status(400).json({ error: "Display name is required." });
  const errors = security.validatePassword(password, username);
  if (errors.length) return res.status(400).json({ error: errors.join(" "), validationErrors: errors });
  const id = crypto.randomUUID();
  const hash = await security.hashPassword(password);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const created = await client.query(
      `INSERT INTO users(id,username,display_name,email,organization,title,password_hash,system_role,status,force_password_change,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,'active',TRUE,$9) RETURNING *`,
      [id, username, displayName, text(req.body?.email, 254), text(req.body?.organization, 200), text(req.body?.title, 200), hash, systemRole, req.user.id]
    );
    await writeAudit(client, { actor: actor(req.user), action: "user.created", entityType: "user", entityId: id, after: security.publicUser(created.rows[0]) });
    await client.query("COMMIT");
    res.status(201).json({ user: security.publicUser(created.rows[0]) });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") return res.status(409).json({ error: "That username already exists." });
    throw error;
  } finally { client.release(); }
}));

app.patch("/api/admin/users/:userId", requireGlobal("users.manage"), asyncRoute(async (req, res) => {
  const beforeResult = await pool.query("SELECT * FROM users WHERE id=$1", [req.params.userId]);
  const before = beforeResult.rows[0];
  if (!before) return res.status(404).json({ error: "User not found." });
  const systemRole = ["administrator", "program_manager", "user"].includes(req.body?.systemRole) ? req.body.systemRole : before.system_role;
  const status = ["active", "disabled"].includes(req.body?.status) ? req.body.status : before.status;
  if (before.id === req.user.id && status === "disabled") return res.status(400).json({ error: "You cannot disable your own account." });
  if (before.system_role === "administrator" && before.status === "active" && (systemRole !== "administrator" || status !== "active")) {
    const count = await pool.query("SELECT COUNT(*)::int AS count FROM users WHERE system_role='administrator' AND status='active'");
    if (count.rows[0].count <= 1) return res.status(400).json({ error: "At least one active System Administrator is required." });
  }
  const result = await pool.query(
    `UPDATE users SET display_name=$2,email=$3,organization=$4,title=$5,system_role=$6,status=$7,updated_at=NOW() WHERE id=$1 RETURNING *`,
    [before.id, text(req.body?.displayName ?? before.display_name, 160), text(req.body?.email ?? before.email, 254), text(req.body?.organization ?? before.organization, 200), text(req.body?.title ?? before.title, 200), systemRole, status]
  );
  if (status === "disabled") await pool.query("DELETE FROM sessions WHERE user_id=$1", [before.id]);
  await recordAudit({ actor: actor(req.user), action: "user.updated", entityType: "user", entityId: before.id, before: security.publicUser(before), after: security.publicUser(result.rows[0]) });
  res.json({ user: security.publicUser(result.rows[0]) });
}));

app.post("/api/admin/users/:userId/reset-password", requireGlobal("users.manage"), asyncRoute(async (req, res) => {
  const password = String(req.body?.temporaryPassword || "");
  const found = await pool.query("SELECT * FROM users WHERE id=$1", [req.params.userId]);
  const user = found.rows[0];
  if (!user) return res.status(404).json({ error: "User not found." });
  const errors = security.validatePassword(password, user.username);
  if (errors.length) return res.status(400).json({ error: errors.join(" ") });
  const hash = await security.hashPassword(password);
  await pool.query("UPDATE users SET password_hash=$2,force_password_change=TRUE,failed_login_count=0,locked_until=NULL,updated_at=NOW() WHERE id=$1", [user.id, hash]);
  await pool.query("DELETE FROM sessions WHERE user_id=$1", [user.id]);
  await recordAudit({ actor: actor(req.user), action: "user.password_reset", entityType: "user", entityId: user.id });
  res.json({ ok: true });
}));

/* ---------------------------------------------------------- team & review */
app.get("/api/assessments/:assessmentId/members", asyncRoute(async (req, res) => {
  if (!(await requireAssessmentPermission(req, res, "assessment.view"))) return;
  const result = await pool.query(
    `SELECT u.id,u.username,u.display_name,u.email,u.organization,u.title,u.status,m.role_id,r.name role_name,m.assigned_at
     FROM assessment_members m JOIN users u ON u.id=m.user_id JOIN roles r ON r.id=m.role_id
     WHERE m.assessment_id=$1 ORDER BY r.name,u.display_name`, [req.params.assessmentId]
  );
  res.json({ members: result.rows.map((row) => ({ id: row.id, username: row.username, displayName: row.display_name, email: row.email, organization: row.organization, title: row.title, status: row.status, roleId: row.role_id, roleName: row.role_name, assignedAt: row.assigned_at })) });
}));

app.get("/api/assessments/:assessmentId/candidates", asyncRoute(async (req, res) => {
  if (!(await requireAssessmentPermission(req, res, "assessment.team.manage"))) return;
  const result = await pool.query(
    `SELECT id,username,display_name,email,organization,title,status,last_login_at
     FROM users WHERE status='active' ORDER BY display_name,username`
  );
  res.json({ users: result.rows.map(security.publicUser) });
}));

app.put("/api/assessments/:assessmentId/members/:userId", asyncRoute(async (req, res) => {
  if (!(await requireAssessmentPermission(req, res, "assessment.team.manage"))) return;
  const roleId = text(req.body?.roleId, 100);
  const role = await pool.query("SELECT id FROM roles WHERE id=$1", [roleId]);
  const user = await pool.query("SELECT id,username,display_name,status FROM users WHERE id=$1", [req.params.userId]);
  if (!role.rowCount || !user.rowCount || user.rows[0].status !== "active") return res.status(400).json({ error: "Select an active user and valid assessment role." });
  await pool.query(
    `INSERT INTO assessment_members(assessment_id,user_id,role_id,assigned_by) VALUES($1,$2,$3,$4)
     ON CONFLICT(assessment_id,user_id) DO UPDATE SET role_id=EXCLUDED.role_id,assigned_by=EXCLUDED.assigned_by,assigned_at=NOW()`,
    [req.params.assessmentId, req.params.userId, roleId, req.user.id]
  );
  await recordAudit({ assessmentId: req.params.assessmentId, actor: actor(req.user), action: "team.member_assigned", entityType: "assessment_member", entityId: req.params.userId, after: { roleId } }, bumpWorkspaceRevision);
  res.json({ ok: true });
}));

app.delete("/api/assessments/:assessmentId/members/:userId", asyncRoute(async (req, res) => {
  if (!(await requireAssessmentPermission(req, res, "assessment.team.manage"))) return;
  if (req.params.userId === req.user.id) return res.status(400).json({ error: "Ask another assessment lead to remove your assignment." });
  const removed = await pool.query("DELETE FROM assessment_members WHERE assessment_id=$1 AND user_id=$2 RETURNING role_id", [req.params.assessmentId, req.params.userId]);
  if (!removed.rowCount) return res.status(404).json({ error: "Team assignment not found." });
  await recordAudit({ assessmentId: req.params.assessmentId, actor: actor(req.user), action: "team.member_removed", entityType: "assessment_member", entityId: req.params.userId, before: { roleId: removed.rows[0].role_id } }, bumpWorkspaceRevision);
  res.json({ ok: true });
}));

app.get("/api/assessments/:assessmentId/reviews", asyncRoute(async (req, res) => {
  if (!(await requireAssessmentPermission(req, res, "assessment.view"))) return;
  const result = await pool.query(
    `SELECT r.id,r.decision,r.comments,r.created_at,u.display_name reviewer_name,u.username reviewer_username
     FROM assessment_reviews r JOIN users u ON u.id=r.reviewer_id WHERE assessment_id=$1 ORDER BY r.created_at DESC`,
    [req.params.assessmentId]
  );
  res.json({ reviews: result.rows });
}));

app.post("/api/assessments/:assessmentId/reviews", asyncRoute(async (req, res) => {
  const decision = text(req.body?.decision, 40);
  const permission = decision === "approved" ? "assessment.approve" : "assessment.review";
  if (!(await requireAssessmentPermission(req, res, permission))) return;
  if (!["submitted", "changes_requested", "approved", "reopened"].includes(decision)) return res.status(400).json({ error: "Invalid review decision." });
  const id = crypto.randomUUID();
  await pool.query("INSERT INTO assessment_reviews(id,assessment_id,reviewer_id,decision,comments) VALUES($1,$2,$3,$4,$5)", [id, req.params.assessmentId, req.user.id, decision, text(req.body?.comments, 5000)]);
  await recordAudit({ assessmentId: req.params.assessmentId, actor: actor(req.user), action: `review.${decision}`, entityType: "assessment_review", entityId: id, after: { decision, comments: text(req.body?.comments, 5000) } }, bumpWorkspaceRevision);
  res.status(201).json({ ok: true, id });
}));

/* --------------------------------------------------------------- audit */
app.get("/api/audit", asyncRoute(async (req, res) => {
  const assessmentId = text(req.query.assessmentId, 120);
  if (assessmentId && !(await requireAssessmentPermission(Object.assign(req, { params: { assessmentId } }), res, "audit.view"))) return;
  if (!assessmentId && !rbac.systemPermissions(req.user.system_role).includes("users.manage")) return res.status(403).json({ error: "Select an assessment whose audit history you can view." });
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit || "100", 10), 1), 500);
  const result = await pool.query(
    `SELECT id,assessment_id,actor_username,actor_display_name,action,entity_type,entity_id,changed_paths,metadata,prev_hash,entry_hash,created_at
     FROM audit_log WHERE ($1::text IS NULL OR assessment_id=$1) ORDER BY id DESC LIMIT $2`,
    [assessmentId || null, limit]
  );
  res.json({ entries: result.rows });
}));

app.use("/api", (_req, res) => res.status(404).json({ error: "Unknown API route.", code: "NOT_FOUND" }));

/* ------------------------------------------------------------ static UI */
const staticOptions = { etag: true, maxAge: process.env.NODE_ENV === "production" ? "1h" : 0, fallthrough: false };
app.use("/css", express.static(path.join(config.appDir, "css"), staticOptions));
app.use("/js", express.static(path.join(config.appDir, "js"), staticOptions));
app.get("*splat", (_req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.sendFile(path.join(config.appDir, "index.html"));
});

app.use((error, _req, res, _next) => {
  console.error(error.stack || error);
  if (error.type === "entity.too.large") return res.status(413).json({ error: `Request exceeds ${config.maxBodyMb} MB.` });
  if (error.status === 404) return res.status(404).json({ error: "Asset not found." });
  res.status(500).json({ error: "Unexpected server error.", code: "INTERNAL_ERROR" });
});

module.exports = app;
