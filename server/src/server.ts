import { buildApp } from "./app.js";
import { createPool } from "./db/pool.js";
import { migrate } from "./db/migrate.js";

const pool = createPool();
await migrate(pool);
const app = await buildApp({ pool });
await app.listen({ host: "0.0.0.0", port: 3000 });
console.log("vocal server listening on :3000");
