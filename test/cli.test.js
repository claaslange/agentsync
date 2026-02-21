import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { main } from "../dist/cli.js";

async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "agentsync-test-"));
  return await fn(dir);
}

function captureConsole(fn) {
  const logs = [];
  const errors = [];
  const origLog = console.log;
  const origErr = console.error;
  console.log = (...args) => logs.push(args.join(" "));
  console.error = (...args) => errors.push(args.join(" "));
  return Promise.resolve()
    .then(fn)
    .then(
      (result) => ({ result, logs, errors }),
      (err) => ({ err, logs, errors }),
    )
    .finally(() => {
      console.log = origLog;
      console.error = origErr;
    });
}

test("renders Liquid variables + if + for", async () => {
  await withTempDir(async (dir) => {
    const templatePath = path.join(dir, "AGENTS_TEMPLATE.md");
    const outClaudePath = path.join(dir, "out-claude.md");
    const outCodexPath = path.join(dir, "out-codex.md");
    await writeFile(
      templatePath,
      [
        "Hello {{ USER }} from {{ AGENT_NAME }}",
        '{% if AGENT_NAME == "Claude" %}CLAUDE{% endif %}',
        "{% for i in (1..3) %}{{ i }}{% endfor %}",
        "",
      ].join("\n"),
      "utf8",
    );
    await writeFile(
      path.join(dir, "agentsync.config.json"),
      JSON.stringify(
        {
          template_path: "AGENTS_TEMPLATE.md",
          targets: [
            {
              agent: "claude",
              path: "out-claude.md",
              variables: { AGENT_NAME: "Claude", USER: "User" },
            },
            {
              agent: "codex",
              path: "out-codex.md",
              variables: { AGENT_NAME: "Codex", USER: "User" },
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );

    const { result, errors } = await captureConsole(
      async () => await main(["sync", "--config", path.join(dir, "agentsync.config.json")]),
    );
    assert.equal(result, 0);
    assert.deepEqual(errors, []);

    const outClaude = await readFile(outClaudePath, "utf8");
    assert.match(outClaude, /Hello User from Claude/);
    assert.match(outClaude, /CLAUDE/);
    assert.match(outClaude, /123/);

    const outCodex = await readFile(outCodexPath, "utf8");
    assert.match(outCodex, /Hello User from Codex/);
    assert.doesNotMatch(outCodex, /Claude/);
    assert.doesNotMatch(outCodex, /CLAUDE/);
    assert.match(outCodex, /123/);
  });
});

test("supports includes resolved from config directory", async () => {
  await withTempDir(async (dir) => {
    const templatesDir = path.join(dir, "templates");
    await mkdir(templatesDir, { recursive: true });

    await writeFile(path.join(dir, "snippet.md"), "Included: {{ USER }}", "utf8");
    await writeFile(
      path.join(templatesDir, "AGENTS_TEMPLATE.md"),
      ["Start", '{% include "snippet.md" %}', "End", ""].join("\n"),
      "utf8",
    );
    await writeFile(
      path.join(dir, "agentsync.config.json"),
      JSON.stringify(
        {
          template_path: "templates/AGENTS_TEMPLATE.md",
          targets: [{ agent: "x", path: "out.md", variables: { USER: "User" } }],
        },
        null,
        2,
      ),
      "utf8",
    );

    const { result } = await captureConsole(
      async () => await main(["sync", "--config", path.join(dir, "agentsync.config.json")]),
    );
    assert.equal(result, 0);

    const out = await readFile(path.join(dir, "out.md"), "utf8");
    assert.match(out, /Start/);
    assert.match(out, /Included: User/);
    assert.match(out, /End/);
  });
});

test("--strict fails on undefined variables", async () => {
  await withTempDir(async (dir) => {
    await writeFile(path.join(dir, "AGENTS_TEMPLATE.md"), "Hello {{ MISSING }}\n", "utf8");
    await writeFile(
      path.join(dir, "agentsync.config.json"),
      JSON.stringify(
        { template_path: "AGENTS_TEMPLATE.md", targets: [{ agent: "x", path: "out.md" }] },
        null,
        2,
      ),
      "utf8",
    );

    const { result, errors } = await captureConsole(
      async () =>
        await main(["sync", "--strict", "--config", path.join(dir, "agentsync.config.json")]),
    );
    assert.equal(result, 1);
    assert.ok(errors.join("\n").includes("undefined variable"));
  });
});

test("dry-run respects overwrite=false (predicts sync refusal)", async () => {
  await withTempDir(async (dir) => {
    await writeFile(path.join(dir, "AGENTS_TEMPLATE.md"), "New content\n", "utf8");
    await writeFile(path.join(dir, "out.md"), "Old content\n", "utf8");
    await writeFile(
      path.join(dir, "agentsync.config.json"),
      JSON.stringify(
        {
          template_path: "AGENTS_TEMPLATE.md",
          options: { overwrite: false, backup: false },
          targets: [{ agent: "x", path: "out.md" }],
        },
        null,
        2,
      ),
      "utf8",
    );

    const { result, errors } = await captureConsole(
      async () => await main(["dry-run", "--config", path.join(dir, "agentsync.config.json")]),
    );
    assert.equal(result, 1);
    assert.ok(errors.join("\n").includes("Refusing to overwrite"));
  });
});
