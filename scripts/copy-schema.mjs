import { mkdir, copyFile } from "node:fs/promises";

await mkdir(new URL("../dist/", import.meta.url), { recursive: true });
await copyFile(
  new URL("../src/agents-sync.schema.json", import.meta.url),
  new URL("../dist/agents-sync.schema.json", import.meta.url),
);
