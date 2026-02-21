import { mkdir, copyFile } from "node:fs/promises";

await mkdir(new URL("../dist/", import.meta.url), { recursive: true });
await copyFile(
  new URL("../src/agentsync.schema.json", import.meta.url),
  new URL("../dist/agentsync.schema.json", import.meta.url),
);
