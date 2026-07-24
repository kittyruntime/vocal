import { buildApp } from "./app.js";

const app = await buildApp();
await app.listen({ host: "0.0.0.0", port: 3000 });
console.log("vocal server listening on :3000");
