"use strict";

const config = require("./src/config");
const { initialize, pool } = require("./src/db");
const app = require("./src/app");

async function start() {
  await initialize();
  await pool.query("DELETE FROM sessions WHERE expires_at<=NOW()");
  const server = app.listen(config.port, () => {
    console.log(`DCS Assessment Command Center v${config.appVersion} listening on :${config.port}`);
  });
  const shutdown = (signal) => {
    console.log(`${signal} received; stopping cleanly.`);
    server.close(async () => { await pool.end(); process.exit(0); });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

start().catch((error) => { console.error("Startup failed:", error); process.exit(1); });
