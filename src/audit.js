"use strict";

const crypto = require("crypto");

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function changedPaths(before, after, prefix = "", output = [], limit = 150) {
  if (output.length >= limit) return output;
  if (JSON.stringify(before) === JSON.stringify(after)) return output;
  if (!before || !after || typeof before !== "object" || typeof after !== "object") {
    output.push(prefix || "root"); return output;
  }
  if (Array.isArray(before) || Array.isArray(after)) {
    const oldItems = Array.isArray(before) ? before : [];
    const newItems = Array.isArray(after) ? after : [];
    const keyed = [...oldItems, ...newItems].every((v) => v && typeof v === "object" && v.id != null);
    if (!keyed) { output.push(prefix || "root"); return output; }
    const oldMap = new Map(oldItems.map((v) => [String(v.id), v]));
    const newMap = new Map(newItems.map((v) => [String(v.id), v]));
    for (const id of new Set([...oldMap.keys(), ...newMap.keys()])) {
      changedPaths(oldMap.get(id), newMap.get(id), `${prefix}[${id}]`, output, limit);
      if (output.length >= limit) break;
    }
    return output;
  }
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (key === "_attribution") continue;
    changedPaths(before[key], after[key], prefix ? `${prefix}.${key}` : key, output, limit);
    if (output.length >= limit) break;
  }
  return output;
}

function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }

function compactSnapshot(value) {
  if (value == null) return value;
  const copy = structuredClone(value);
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.attachment && typeof node.attachment === "object") {
      const bytes = typeof node.attachment.dataUrl === "string" ? node.attachment.dataUrl.length : 0;
      node.attachment = Object.assign({}, node.attachment, { dataUrl: bytes ? `[omitted ${bytes} encoded bytes]` : undefined });
    }
    for (const [key, item] of Object.entries(node)) {
      if (typeof item === "string" && item.length > 5000) node[key] = `${item.slice(0, 5000)}…[truncated]`;
      else if (item && typeof item === "object") walk(item);
    }
  };
  walk(copy);
  return copy;
}

function auditExcerpt(state, paths) {
  if (!state) return null;
  const excerpt = { id: state.id, name: state.name };
  for (const path of paths || []) {
    if (path === "root") return compactSnapshot(state);
    const match = String(path).match(/^([^.[\]]+)(?:\[([^\]]+)\])?/);
    if (!match) continue;
    const [, root, recordId] = match;
    if (recordId && Array.isArray(state[root])) {
      if (!excerpt[root]) excerpt[root] = [];
      const record = state[root].find((item) => String(item.id) === recordId);
      if (record && !excerpt[root].some((item) => String(item.id) === recordId)) excerpt[root].push(record);
    } else if (Object.prototype.hasOwnProperty.call(state, root)) excerpt[root] = state[root];
  }
  return compactSnapshot(excerpt);
}

function stampAttribution(event, before, user, timestamp = new Date().toISOString()) {
  const next = structuredClone(event);
  const actor = { id: user.id, username: user.username, displayName: user.display_name };
  next._attribution = Object.assign({}, before?._attribution || {}, next._attribution || {}, {
    createdAt: before?._attribution?.createdAt || next.createdAt || timestamp,
    createdBy: before?._attribution?.createdBy || actor,
    updatedAt: timestamp,
    updatedBy: actor,
    revision: Number(before?._attribution?.revision || 0) + 1
  });
  const collections = ["missionThreads", "assets", "participants", "systems", "checklist", "testCards", "evidence", "findings", "dailyLogs"];
  for (const name of collections) {
    if (!Array.isArray(next[name])) continue;
    const previous = new Map((before?.[name] || []).map((item) => [String(item.id), item]));
    next[name] = next[name].map((item) => {
      const old = previous.get(String(item.id));
      if (old && same(old, item)) return item;
      return Object.assign({}, item, {
        _attribution: Object.assign({}, old?._attribution || {}, item._attribution || {}, {
          createdAt: old?._attribution?.createdAt || item.createdAt || timestamp,
          createdBy: old?._attribution?.createdBy || actor,
          updatedAt: timestamp,
          updatedBy: actor
        })
      });
    });
  }
  return next;
}

async function writeAudit(client, { assessmentId = null, actor, action, entityType, entityId = null, paths = [], before = null, after = null, metadata = {} }) {
  await client.query("SELECT pg_advisory_xact_lock(20260715)");
  {
    const previous = await client.query("SELECT entry_hash FROM audit_log ORDER BY id DESC LIMIT 1");
    const prevHash = previous.rows[0]?.entry_hash || "GENESIS";
    const createdAt = new Date().toISOString();
    const payload = stable({ assessmentId, actorId: actor.id, actorUsername: actor.username, action, entityType, entityId, paths, before, after, metadata, prevHash, createdAt });
    const entryHash = crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    await client.query(
      `INSERT INTO audit_log(assessment_id,actor_id,actor_username,actor_display_name,action,entity_type,entity_id,changed_paths,before_state,after_state,metadata,prev_hash,entry_hash,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11::jsonb,$12,$13,$14)`,
      [assessmentId, actor.id, actor.username, actor.display_name, action, entityType, entityId,
        JSON.stringify(paths), before == null ? null : JSON.stringify(before), after == null ? null : JSON.stringify(after),
        JSON.stringify(metadata), prevHash, entryHash, createdAt]
    );
    return entryHash;
  }
}

module.exports = { changedPaths, stampAttribution, writeAudit, compactSnapshot, auditExcerpt };
