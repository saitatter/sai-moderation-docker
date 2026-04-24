import { createModerationServer } from "./server.js";

const port = Number.parseInt(process.env.PORT || "8787", 10);
const app = createModerationServer({ logger: console });
await app.start(port);
