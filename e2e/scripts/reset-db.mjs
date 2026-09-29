// Drops and recreates the E2E database so every run starts from the setup
// screen. Connects to the server's maintenance database (`postgres`) with the
// same credentials as E2E_DATABASE_URL; migrations run when the server boots.
import pg from "pg";

const target = new URL(process.env.E2E_DATABASE_URL);
const dbName = target.pathname.slice(1);
if (!/^[a-z0-9_]+$/.test(dbName) || !dbName.includes("e2e")) {
  throw new Error(`refusing to reset "${dbName}": E2E database names must contain "e2e"`);
}
const admin = new URL(target);
admin.pathname = "/postgres";
const client = new pg.Client({ connectionString: admin.toString() });
await client.connect();
try {
  await client.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await client.query(`CREATE DATABASE ${dbName}`);
} finally {
  await client.end();
}
