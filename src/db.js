"use strict";

const { Pool } = require("pg");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const config = require("./config");
const { ROLE_DEFINITIONS } = require("./rbac");

const pool = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.dbSsl ? { rejectUnauthorized: false } : false,
  max: Number.parseInt(process.env.DB_POOL_MAX || "10", 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000
});

const SCHEMA = `
CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  organization TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  password_hash TEXT NOT NULL,
  system_role TEXT NOT NULL DEFAULT 'user' CHECK (system_role IN ('administrator','program_manager','user')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled')),
  force_password_change BOOLEAN NOT NULL DEFAULT TRUE,
  failed_login_count INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMPTZ,
  last_login_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  permissions JSONB NOT NULL,
  system BOOLEAN NOT NULL DEFAULT TRUE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS assessments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  classification TEXT NOT NULL DEFAULT 'UNCLASSIFIED',
  phase TEXT NOT NULL DEFAULT 'planning',
  state JSONB NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  created_by UUID NOT NULL REFERENCES users(id),
  updated_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS assessment_members (
  assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES roles(id),
  assigned_by UUID NOT NULL REFERENCES users(id),
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (assessment_id, user_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS assessment_reviews (
  id UUID PRIMARY KEY,
  assessment_id TEXT NOT NULL REFERENCES assessments(id) ON DELETE CASCADE,
  reviewer_id UUID NOT NULL REFERENCES users(id),
  decision TEXT NOT NULL CHECK (decision IN ('submitted','changes_requested','approved','reopened')),
  comments TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id BIGSERIAL PRIMARY KEY,
  assessment_id TEXT REFERENCES assessments(id),
  actor_id UUID REFERENCES users(id),
  actor_username TEXT NOT NULL,
  actor_display_name TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  changed_paths JSONB NOT NULL DEFAULT '[]'::jsonb,
  before_state JSONB,
  after_state JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  prev_hash TEXT,
  entry_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_assessment_members_user ON assessment_members(user_id);
CREATE INDEX IF NOT EXISTS idx_assessments_active ON assessments(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_sessions_expiry ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_audit_assessment_time ON audit_log(assessment_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor_time ON audit_log(actor_id, created_at DESC);
`;

async function initialize() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(SCHEMA);
    for (const role of ROLE_DEFINITIONS) {
      await client.query(
        `INSERT INTO roles (id,name,description,permissions) VALUES ($1,$2,$3,$4::jsonb)
         ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, description=EXCLUDED.description, permissions=EXCLUDED.permissions, updated_at=NOW()`,
        [role.id, role.name, role.description, JSON.stringify(role.permissions)]
      );
    }
    const existing = await client.query("SELECT id FROM users WHERE username=$1", [config.adminUsername]);
    if (!existing.rowCount) {
      const id = crypto.randomUUID();
      const hash = await bcrypt.hash(config.adminPassword, 12);
      await client.query(
        `INSERT INTO users (id,username,display_name,email,password_hash,system_role,status,force_password_change)
         VALUES ($1,$2,$3,'',$4,'administrator','active',TRUE)`,
        [id, config.adminUsername, config.adminName, hash]
      );
      console.log(`Bootstrap administrator created: ${config.adminUsername} (password change required)`);
    }
    await client.query("INSERT INTO app_meta(key,value) VALUES ('workspace_revision','0'::jsonb) ON CONFLICT DO NOTHING");
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function workspaceRevision(client = pool) {
  const result = await client.query("SELECT value FROM app_meta WHERE key='workspace_revision'");
  return Number(result.rows[0]?.value || 0);
}

async function bumpWorkspaceRevision(client) {
  const result = await client.query(
    `UPDATE app_meta SET value=to_jsonb((value::text)::int + 1), updated_at=NOW()
     WHERE key='workspace_revision' RETURNING value`
  );
  return Number(result.rows[0].value);
}

module.exports = { pool, initialize, workspaceRevision, bumpWorkspaceRevision };
