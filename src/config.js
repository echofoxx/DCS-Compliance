"use strict";

const path = require("path");

function bool(name, fallback = false) {
  const value = process.env[name];
  return value == null ? fallback : /^(1|true|yes|on)$/i.test(value);
}

module.exports = {
  port: Number.parseInt(process.env.PORT || "8080", 10),
  appDir: path.resolve(__dirname, ".."),
  databaseUrl: process.env.DATABASE_URL || "postgres://dcs:dcs@localhost:5432/dcs",
  dbSsl: bool("DATABASE_SSL", false),
  trustProxy: Number.parseInt(process.env.TRUST_PROXY || "0", 10),
  secureCookies: bool("SECURE_COOKIES", process.env.NODE_ENV === "production"),
  sessionHours: Number.parseInt(process.env.SESSION_HOURS || "12", 10),
  maxBodyMb: Number.parseInt(process.env.MAX_BODY_MB || "32", 10),
  adminUsername: (process.env.ADMIN_USERNAME || "admin").trim().toLowerCase(),
  adminPassword: process.env.ADMIN_PASSWORD || "ChangeMe!DCS2026",
  adminName: process.env.ADMIN_DISPLAY_NAME || "DCS System Administrator",
  allowSampleData: bool("SEED_SAMPLE_DATA", true),
  appVersion: require("../package.json").version
};
