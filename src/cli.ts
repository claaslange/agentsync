import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Liquid } from "liquidjs";

type JsonScalar = string | number | boolean | null;

type TargetEntry = { agent: string; path: string; enabled?: boolean; variables?: Record<string, JsonScalar> };
type Config = {
  template_path?: string;
  options?: {
    overwrite?: boolean;
    backup?: boolean;
    backup_suffix?: string;
  };
  targets: TargetEntry[];
};

type Target = { agentName: string; rawPath: string; enabled: boolean };

function eprint(message: string): void {
  // eslint-disable-next-line no-console
  console.error(message);
}

function printHelp(): void {
  // Minimal help to keep this dependency-free.
  // eslint-disable-next-line no-console
  console.log(
    [
      "agentsync - sync one agent instructions template to many targets",
      "",
      "Usage:",
      "  agentsync help",
      "  agentsync sync [--config <path>] [--template <path>] [--strict]",
      "  agentsync dry-run [--config <path>] [--template <path>] [--strict]",
      "  agentsync check [--config <path>] [--template <path>] [--strict]",
      "",
      "Flags:",
      "  --config   Path to config JSON (default: ~/.agentsync/agentsync.config.json)",
      "  --template Override template path (otherwise config.template_path / ~/.agentsync/AGENTS_TEMPLATE.md is used)",
      "  --strict   Fail if any template variables are undefined",
      "",
      "Defaults (when no --config is provided):",
      "  1) ~/.agentsync/agentsync.config.json",
      "  2) ./agentsync.config.json",
    ].join("\n"),
  );
}

type JsonSchema = Record<string, unknown>;
let schemaCache: JsonSchema | null = null;

async function loadBundledSchema(): Promise<JsonSchema> {
  if (schemaCache) return schemaCache;
  const schemaPath = fileURLToPath(new URL("./agentsync.schema.json", import.meta.url));
  const text = await readFile(schemaPath, "utf8");
  const parsed: unknown = JSON.parse(text);
  if (!isObject(parsed)) throw new Error(`Invalid bundled schema at ${schemaPath}`);
  schemaCache = parsed;
  return schemaCache;
}

function schemaTypeMatches(value: unknown, type: string): boolean {
  switch (type) {
    case "null":
      return value === null;
    case "boolean":
      return typeof value === "boolean";
    case "number":
      return typeof value === "number";
    case "string":
      return typeof value === "string";
    case "object":
      return isObject(value);
    case "array":
      return Array.isArray(value);
    default:
      return false;
  }
}

function validateSchemaNode(schema: unknown, value: unknown, at: string, errors: string[]): void {
  if (!isObject(schema)) return;

  const typeSpec = schema["type"];
  if (typeof typeSpec === "string") {
    if (!schemaTypeMatches(value, typeSpec)) {
      errors.push(`${at}: expected ${typeSpec}`);
      return;
    }
  } else if (Array.isArray(typeSpec)) {
    const ok = typeSpec.some((t) => typeof t === "string" && schemaTypeMatches(value, t));
    if (!ok) {
      errors.push(`${at}: expected one of ${typeSpec.join(", ")}`);
      return;
    }
  }

  const minLength = schema["minLength"];
  if (typeof minLength === "number" && typeof value === "string" && value.length < minLength) {
    errors.push(`${at}: string must have minLength ${minLength}`);
  }

  const minItems = schema["minItems"];
  if (typeof minItems === "number" && Array.isArray(value) && value.length < minItems) {
    errors.push(`${at}: array must have minItems ${minItems}`);
  }

  const required = schema["required"];
  if (Array.isArray(required) && isObject(value)) {
    for (const k of required) {
      if (typeof k !== "string") continue;
      if (!(k in value)) errors.push(`${at}: missing required property ${k}`);
    }
  }

  const properties = schema["properties"];
  if (isObject(properties) && isObject(value)) {
    for (const [k, propSchema] of Object.entries(properties)) {
      if (k in value) validateSchemaNode(propSchema, value[k], `${at}.${k}`, errors);
    }
  }

  const items = schema["items"];
  if (items !== undefined && Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) validateSchemaNode(items, value[i], `${at}[${i}]`, errors);
  }

  const additionalProperties = schema["additionalProperties"];
  if (isObject(value)) {
    if (additionalProperties === false) {
      const allowed = new Set<string>();
      if (isObject(properties)) for (const k of Object.keys(properties)) allowed.add(k);
      for (const k of Object.keys(value)) {
        if (!allowed.has(k)) errors.push(`${at}: unexpected property ${k}`);
      }
    } else if (isObject(additionalProperties)) {
      const allowed = new Set<string>();
      if (isObject(properties)) for (const k of Object.keys(properties)) allowed.add(k);
      for (const [k, v] of Object.entries(value)) {
        if (allowed.has(k)) continue;
        validateSchemaNode(additionalProperties, v, `${at}.${k}`, errors);
      }
    }
  }
}

function parseCommonArgs(argv: string[]): {
  configPath: string;
  configPathWasDefault: boolean;
  templatePathOverride: string | null;
  strict: boolean;
} {
  let configPath = "~/.agentsync/agentsync.config.json";
  let configPathWasDefault = true;
  let templatePathOverride: string | null = null;
  let strict = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--config") {
      const next = argv[i + 1];
      if (!next) throw new Error("Missing value for --config");
      configPath = next;
      configPathWasDefault = false;
      i += 1;
      continue;
    }
    if (arg === "--template") {
      const next = argv[i + 1];
      if (!next) throw new Error("Missing value for --template");
      templatePathOverride = next;
      i += 1;
      continue;
    }
    if (arg === "--strict") {
      strict = true;
      continue;
    }
    if (arg === "-h" || arg === "--help") {
      printHelp();
      process.exit(0);
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return { configPath, configPathWasDefault, templatePathOverride, strict };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function expandTilde(p: string): string {
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

function expandEnv(p: string): string {
  // Support $VAR and ${VAR}
  return p
    .replace(/\$\{([A-Z0-9_]+)\}/gi, (_, name: string) => process.env[name] ?? `\${${name}}`)
    .replace(/\$([A-Z0-9_]+)/gi, (_, name: string) => process.env[name] ?? `$${name}`);
}

function resolvePath(rawPath: string, baseDir: string): string {
  const expanded = expandEnv(expandTilde(rawPath));
  if (path.isAbsolute(expanded)) return expanded;
  return path.resolve(baseDir, expanded);
}

async function loadConfig(configPath: string): Promise<{ config: Config; baseDir: string }> {
  const absoluteConfigPath = resolvePath(configPath, process.cwd());
  let parsed: unknown;
  try {
    const text = await readFile(absoluteConfigPath, "utf8");
    parsed = JSON.parse(text);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read config ${absoluteConfigPath}: ${message}`);
  }

  if (!isObject(parsed)) throw new Error("Config must be a JSON object");
  const cfg = parsed as Record<string, unknown>;

  const schema = await loadBundledSchema();
  const errors: string[] = [];
  validateSchemaNode(schema, parsed, "$", errors);
  if (errors.length > 0) throw new Error(`Config does not match schema:\n- ${errors.join("\n- ")}`);

  if (cfg["template_path"] !== undefined && typeof cfg["template_path"] !== "string") {
    throw new Error("Config field `template_path` must be a string when present");
  }
  if (cfg["targets"] === undefined) throw new Error("Config field `targets` is required");
  if (!Array.isArray(cfg["targets"])) throw new Error("Config field `targets` must be an array");

  return { config: parsed as Config, baseDir: path.dirname(absoluteConfigPath) };
}

async function loadConfigWithDefaultFallback(opts: {
  configPath: string;
  configPathWasDefault: boolean;
}): Promise<{ config: Config; baseDir: string; configPath: string }> {
  if (!opts.configPathWasDefault) {
    const loaded = await loadConfig(opts.configPath);
    return { ...loaded, configPath: resolvePath(opts.configPath, process.cwd()) };
  }

  const homeCandidate = resolvePath("~/.agentsync/agentsync.config.json", process.cwd());
  if (existsSync(homeCandidate)) {
    const loaded = await loadConfig(homeCandidate);
    return { ...loaded, configPath: homeCandidate };
  }

  const cwdCandidate = path.resolve(process.cwd(), "agentsync.config.json");
  if (existsSync(cwdCandidate)) {
    const loaded = await loadConfig(cwdCandidate);
    return { ...loaded, configPath: cwdCandidate };
  }

  throw new Error(
    `Config not found: tried ${homeCandidate} and ${cwdCandidate} (use --config to specify)`,
  );
}

function iterTargets(targetsCfg: unknown): Array<Target & { variables: Record<string, string> }> {
  if (!Array.isArray(targetsCfg)) throw new Error("targets must be an array");
  const targets: Array<Target & { variables: Record<string, string> }> = [];

  for (let i = 0; i < targetsCfg.length; i += 1) {
    const entry = targetsCfg[i];
    if (!isObject(entry)) throw new Error(`targets[${i}] must be an object`);
    const agent = entry["agent"];
    const rawPath = entry["path"];
    const enabled = entry["enabled"];
    const vars = entry["variables"];
    if (typeof agent !== "string" || agent.length === 0) throw new Error(`targets[${i}].agent must be a non-empty string`);
    if (typeof rawPath !== "string" || rawPath.length === 0) throw new Error(`targets[${i}].path must be a non-empty string`);
    if (enabled !== undefined && typeof enabled !== "boolean") throw new Error(`targets[${i}].enabled must be boolean when present`);
    const variables = coerceVariables(vars);
    targets.push({ agentName: agent, rawPath, enabled: enabled ?? true, variables });
  }

  return targets;
}

async function renderTemplate(
  templateText: string,
  variables: Record<string, string>,
  strict: boolean,
  liquid: Liquid,
): Promise<string> {
  return await liquid.parseAndRender(templateText, variables, {
    strictVariables: strict,
  });
}

async function readTextIfExists(filePath: string): Promise<string | null> {
  if (!existsSync(filePath)) return null;
  return await readFile(filePath, "utf8");
}

async function uniqueBackupPath(dest: string, suffix: string): Promise<string> {
  const base = `${dest}${suffix}`;
  if (!existsSync(base)) return base;
  for (let i = 1; i < 1000; i += 1) {
    const candidate = `${dest}${suffix}.${i}`;
    if (!existsSync(candidate)) return candidate;
  }
  throw new Error(`Too many backup files for ${dest}`);
}

async function writeFileIfChanged(opts: {
  dest: string;
  content: string;
  overwrite: boolean;
  backup: boolean;
  backupSuffix: string;
  dryRun: boolean;
  check: boolean;
}): Promise<boolean> {
  const existing = await readTextIfExists(opts.dest);
  if (existing === opts.content) return false;

  if (existing !== null && !opts.overwrite) {
    throw new Error(`Refusing to overwrite existing file (set options.overwrite=true): ${opts.dest}`);
  }

  if (opts.dryRun || opts.check) return true;

  await mkdir(path.dirname(opts.dest), { recursive: true });
  if (existing !== null && opts.backup) {
    const backupPath = await uniqueBackupPath(opts.dest, opts.backupSuffix);
    await copyFile(opts.dest, backupPath);
  }
  await writeFile(opts.dest, opts.content, "utf8");
  return true;
}

function coerceVariables(varsCfg: unknown): Record<string, string> {
  if (varsCfg === undefined) return {};
  if (!isObject(varsCfg)) throw new Error("Config field `variables` must be an object");
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(varsCfg)) {
    if (typeof k !== "string") throw new Error("variables keys must be strings");
    const ok =
      typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v === null;
    if (!ok) throw new Error("variables values must be JSON scalars (string/number/boolean/null)");
    out[k] = String(v);
  }
  return out;
}

export async function main(argv: string[]): Promise<number> {
  try {
    if (argv.length === 0) {
      printHelp();
      return 0;
    }

    const command = argv[0];
    if (command === "help" || command === "-h" || command === "--help") {
      printHelp();
      return 0;
    }
    if (command !== "sync" && command !== "dry-run" && command !== "check") {
      printHelp();
      return 1;
    }

    const dryRun = command === "dry-run";
    const check = command === "check";
    const { configPath, configPathWasDefault, templatePathOverride, strict } = parseCommonArgs(argv.slice(1));
    const { config, baseDir } = await loadConfigWithDefaultFallback({ configPath, configPathWasDefault });

    const templatePath = templatePathOverride
      ? resolvePath(templatePathOverride, process.cwd())
      : resolvePath(config.template_path ?? "~/.agentsync/AGENTS_TEMPLATE.md", baseDir);
    let templateText: string;
    try {
      templateText = await readFile(templatePath, "utf8");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to read template ${templatePath}: ${message}`);
    }

    const options = config.options ?? {};
    const overwrite = options.overwrite ?? true;
    const backup = options.backup ?? true;
    const backupSuffix = options.backup_suffix ?? ".bak";
    if (typeof backupSuffix !== "string" || backupSuffix.length === 0) {
      throw new Error("options.backup_suffix must be a non-empty string");
    }

    const targets = iterTargets(config.targets as unknown);
    const enabledTargets = targets.filter((t) => t.enabled);
    if (enabledTargets.length === 0) {
      eprint("No enabled targets. Set `enabled: true` for at least one entry in `targets`.");
      return 2;
    }

    const timestamp = new Date()
      .toISOString()
      .replaceAll("-", "")
      .replaceAll(":", "")
      .replace(".", "")
      .slice(0, 14);

    const liquidRoots = Array.from(new Set([path.dirname(templatePath), baseDir]));
    const liquid = new Liquid({
      root: liquidRoots,
      partials: liquidRoots,
      layouts: liquidRoots,
      extname: "",
      cache: false,
      lenientIf: true,
      fs: {
        sep: path.sep,
        dirname: (file) => path.dirname(file),
        contains: (root, file) => {
          const rel = path.relative(root, file);
          return rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel);
        },
        exists: async (filepath) => existsSync(filepath),
        existsSync: (filepath) => existsSync(filepath),
        readFile: async (filepath) => await readFile(filepath, "utf8"),
        readFileSync: (filepath) => readFileSync(filepath, "utf8"),
        resolve: (dir, file, ext) => {
          const withExt = path.extname(file) ? file : `${file}${ext}`;
          return path.resolve(dir, withExt);
        },
      },
    });

    let anyChanges = false;
    for (const target of enabledTargets) {
      const dest = resolvePath(target.rawPath, baseDir);
      const builtins: Record<string, string> = {
        AGENT_NAME: target.agentName,
        TARGET_PATH: dest,
        TEMPLATE_PATH: templatePath,
        RUN_TIMESTAMP: timestamp,
      };
      const varsForTarget: Record<string, string> = {
        ...builtins,
        ...target.variables,
      };

      const rendered = await renderTemplate(templateText, varsForTarget, strict, liquid);
      const changed = await writeFileIfChanged({
        dest,
        content: rendered,
        overwrite,
        backup,
        backupSuffix,
        dryRun,
        check,
      });

      const status = dryRun || check ? (changed ? "would update" : "ok") : changed ? "updated" : "ok";
      // eslint-disable-next-line no-console
      console.log(`[${target.agentName}] ${status}: ${dest}`);

      anyChanges = anyChanges || changed;
    }

    if (check) return anyChanges ? 1 : 0;
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    eprint(message);
    return 1;
  }
}

function isDirectExecution(): boolean {
  try {
    const modulePath = fileURLToPath(import.meta.url);
    const argv1 = process.argv[1];
    if (!argv1) return false;
    return path.resolve(argv1) === path.resolve(modulePath);
  } catch {
    return false;
  }
}

if (isDirectExecution()) {
  // When executed directly (e.g. `bun src/cli.ts`), behave like the installed binary.
  // eslint-disable-next-line no-console
  process.exit(await main(process.argv.slice(2)));
}
