"use strict";

const crypto = require("crypto");
const bcrypt = require("bcryptjs");
const config = require("./config");
const { pool } = require("./db");

const COOKIE = "dcs_session";

function randomToken(bytes = 32) { return crypto.randomBytes(bytes).toString("base64url"); }
function tokenHash(token) { return crypto.createHash("sha256").update(token).digest("hex"); }
function normalizeUsername(value) { return String(value || "").trim().toLowerCase(); }

function validatePassword(password, username = "") {
  const p = String(password || "");
  const errors = [];
  if (p.length < 12) errors.push("Use at least 12 characters.");
  if (p.length > 128) errors.push("Use no more than 128 characters.");
  if (!/[A-Z]/.test(p)) errors.push("Include an uppercase letter.");
  if (!/[a-z]/.test(p)) errors.push("Include a lowercase letter.");
  if (!/[0-9]/.test(p)) errors.push("Include a number.");
  if (!/[^A-Za-z0-9]/.test(p)) errors.push("Include a symbol.");
  if (username && p.toLowerCase().includes(String(username).toLowerCase())) errors.push("Do not include the username.");
  return errors;
}

async function createSession(user, req, res) {
  const raw = randomToken(48);
  const csrf = randomToken(32);
  const expires = new Date(Date.now() + config.sessionHours * 3600_000);
  await pool.query(
    `INSERT INTO sessions(token_hash,user_id,csrf_token,ip_address,user_agent,expires_at)
     VALUES($1,$2,$3,$4,$5,$6)`,
    [tokenHash(raw), user.id, csrf, req.ip, String(req.headers["user-agent"] || "").slice(0, 500), expires]
  );
  res.cookie(COOKIE, raw, {
    httpOnly: true, secure: config.secureCookies, sameSite: "strict", path: "/", expires
  });
  return csrf;
}

async function destroySession(req, res) {
  const raw = req.cookies?.[COOKIE];
  if (raw) await pool.query("DELETE FROM sessions WHERE token_hash=$1", [tokenHash(raw)]);
  res.clearCookie(COOKIE, { httpOnly: true, secure: config.secureCookies, sameSite: "strict", path: "/" });
}

async function authenticate(req, _res, next) {
  try {
    const raw = req.cookies?.[COOKIE];
    if (!raw) return next();
    const result = await pool.query(
      `SELECT s.csrf_token,s.expires_at,u.id,u.username,u.display_name,u.email,u.organization,u.title,
              u.system_role,u.status,u.force_password_change,u.last_login_at
       FROM sessions s JOIN users u ON u.id=s.user_id
       WHERE s.token_hash=$1 AND s.expires_at>NOW()`,
      [tokenHash(raw)]
    );
    const row = result.rows[0];
    if (!row || row.status !== "active") return next();
    req.user = row;
    req.csrfToken = row.csrf_token;
    if (Math.random() < 0.05) {
      pool.query("UPDATE sessions SET last_seen_at=NOW() WHERE token_hash=$1", [tokenHash(raw)]).catch(() => {});
    }
    next();
  } catch (error) { next(error); }
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "Authentication required", code: "AUTH_REQUIRED" });
  next();
}

function requireCsrf(req, res, next) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const supplied = String(req.headers["x-csrf-token"] || "");
  const expected = String(req.csrfToken || "");
  const a = Buffer.from(supplied); const b = Buffer.from(expected);
  if (!a.length || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(403).json({ error: "Invalid CSRF token", code: "CSRF_INVALID" });
  }
  next();
}

async function verifyPassword(user, password) { return bcrypt.compare(String(password || ""), user.password_hash); }
async function hashPassword(password) { return bcrypt.hash(password, 12); }

function publicUser(row) {
  return {
    id: row.id, username: row.username, displayName: row.display_name,
    email: row.email || "", organization: row.organization || "", title: row.title || "",
    systemRole: row.system_role, status: row.status, forcePasswordChange: !!row.force_password_change,
    lastLoginAt: row.last_login_at || null
  };
}

module.exports = {
  COOKIE, normalizeUsername, validatePassword, createSession, destroySession,
  authenticate, requireAuth, requireCsrf, verifyPassword, hashPassword, publicUser
};
