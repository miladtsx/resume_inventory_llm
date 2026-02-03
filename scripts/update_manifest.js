#!/usr/bin/env node
/**
 * update-manifest.js
 * Regenerates manifest + search_blob fields in a resume inventory JSON.
 *
 * Usage:
 *   node update-manifest.js --in inventory.json --out inventory.json
 *   node update-manifest.js --in inventory.json --out inventory.v1.json
 */

const fs = require("fs");
const path = require("path");

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i];
    const v = argv[i + 1];
    if (k === "--in") args.in = v;
    if (k === "--out") args.out = v;
    if (k === "--dry") args.dry = true;
  }
  if (!args.in) throw new Error("Missing --in <file>");
  if (!args.out) args.out = args.in;
  return args;
}

function normalizeSpace(s) {
  return String(s || "").replace(/\s+/g, " ").trim();
}

function bumpPatchVersion(ver) {
  // "1.4.0" -> "1.4.1"; if invalid, leave unchanged.
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(ver || ""));
  if (!m) return ver;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const patch = Number(m[3]) + 1;
  return `${major}.${minor}.${patch}`;
}

function uniqPreserve(arr) {
  const seen = new Set();
  const out = [];
  for (const x of arr) {
    const k = String(x);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(x);
    }
  }
  return out;
}

function collectTagsFromBullets(bullets = []) {
  const tags = [];
  for (const b of bullets) {
    if (Array.isArray(b?.tags)) tags.push(...b.tags.filter(Boolean));
  }
  return uniqPreserve(tags.map(String));
}

function scoreBullet(b) {
  const metric = b?.claim_type === "metric" ? 1 : 0;
  const conf = { high: 3, medium: 2, low: 1 }[b?.confidence] || 1;
  return metric * 10 + conf; // metric dominates
}

function pickBestBullets(item, maxN = 3) {
  const bullets = Array.isArray(item?.bullets) ? item.bullets : [];
  return [...bullets]
    .sort((a, b) => scoreBullet(b) - scoreBullet(a))
    .slice(0, maxN);
}

// Keep the token list conservative; it's for retrieval, not truth.
const TECH_TOKENS = [
  "node", "node.js", "typescript", "javascript", "python", "react", "next.js",
  "aws", "lambda", "api gateway", "s3", "cloudfront",
  "gcp", "cloud run", "vertex ai",
  "docker", "kubernetes",
  "postgres", "postgresql", "redis", "kafka", "rabbitmq",
  "grafana", "prometheus", "opentelemetry", "otel",
  "rest", "graphql", "websockets", "microservices",
  "ci/cd", "cicd", "devops", "nginx",
  "solidity", "ethereum", "smart contracts",
  "hyperledger", "fabric",
  "c#", ".net", "asp.net", "oracle", "db2",
  "omnet++", "mpls", "c++",
  "n8n", "langchain"
];

function extractTechTokens(text) {
  const t = String(text || "").toLowerCase();
  const found = [];
  for (const tok of TECH_TOKENS) {
    if (t.includes(tok)) found.push(tok);
  }
  return uniqPreserve(found);
}

function buildSearchBlobExperience(exp) {
  const parts = [];
  if (exp?.org) parts.push(exp.org);
  if (exp?.org_descriptor) parts.push(exp.org_descriptor);
  if (exp?.role?.title) parts.push(exp.role.title);

  const start = exp?.dates?.start || "";
  const end = exp?.dates?.end || "present";
  if (start || exp?.dates?.end) parts.push(`dates ${start}–${end}`);

  if (Array.isArray(exp?.stack_scope)) {
    for (const ss of exp.stack_scope) {
      if (ss?.text) parts.push(ss.text);
    }
  }

  for (const b of pickBestBullets(exp, 3)) {
    parts.push(b?.text_short || b?.text_long || "");
  }

  const tags = collectTagsFromBullets(exp?.bullets);
  if (tags.length) parts.push(`tags ${tags.sort().join(" ")}`);

  let blob = normalizeSpace(parts.filter(Boolean).join(" | "));
  const tech = extractTechTokens(blob);
  if (tech.length) blob = `${blob} | tech ${tech.join(" ")}`;
  return blob;
}

function buildSearchBlobProject(p) {
  const parts = [];
  if (p?.name) parts.push(p.name);
  if (p?.descriptor) parts.push(p.descriptor);
  if (p?.role?.title) parts.push(p.role.title);

  const start = p?.dates?.start || "";
  const end = p?.dates?.end || "present";
  if (start || p?.dates?.end) parts.push(`dates ${start}–${end}`);

  if (p?.description) parts.push(p.description);

  for (const b of pickBestBullets(p, 3)) {
    parts.push(b?.text_short || b?.text_long || "");
  }

  const tags = collectTagsFromBullets(p?.bullets);
  if (tags.length) parts.push(`tags ${tags.sort().join(" ")}`);

  let blob = normalizeSpace(parts.filter(Boolean).join(" | "));
  const tech = extractTechTokens(blob);
  if (tech.length) blob = `${blob} | tech ${tech.join(" ")}`;
  return blob;
}

function validateInventory(inv) {
  const errors = [];

  // Unique IDs in experiences/projects
  const seen = new Set();
  const checkList = (items, label) => {
    for (const it of items) {
      const id = it?.id;
      if (!id) errors.push(`${label}: item missing id`);
      else if (seen.has(id)) errors.push(`duplicate id: ${id}`);
      else seen.add(id);
    }
  };

  const exps = inv?.experience?.items || [];
  const projs = inv?.projects?.items || [];
  if (!Array.isArray(exps)) errors.push("experience.items is not an array");
  if (!Array.isArray(projs)) errors.push("projects.items is not an array");

  checkList(exps, "experience");
  checkList(projs, "projects");

  // Tag whitelist validation (optional, but good)
  const allowed = new Set(inv?.controlled_vocabulary?.tags || []);
  const validateTags = (obj, ctx) => {
    if (!obj) return;
    if (Array.isArray(obj)) {
      obj.forEach((x, i) => validateTags(x, `${ctx}[${i}]`));
      return;
    }
    if (typeof obj === "object") {
      for (const [k, v] of Object.entries(obj)) {
        if (k === "tags" && Array.isArray(v)) {
          for (const t of v) {
            if (typeof t === "string" && t.trim() && allowed.size && !allowed.has(t)) {
              errors.push(`invalid tag '${t}' at ${ctx}.tags`);
            }
          }
        } else {
          validateTags(v, `${ctx}.${k}`);
        }
      }
    }
  };
  validateTags(inv, "root");

  return errors;
}

function updateManifest(inv) {
  const exps = inv.experience?.items || [];
  const projs = inv.projects?.items || [];

  for (const e of exps) e.search_blob = buildSearchBlobExperience(e);
  for (const p of projs) p.search_blob = buildSearchBlobProject(p);

  inv.manifest = {
    experiences: exps.map((e) => ({
      id: e.id,
      org: e.org,
      dates: e.dates || {},
      search_blob: e.search_blob
    })),
    projects: projs.map((p) => ({
      id: p.id,
      name: p.name,
      dates: p.dates || {},
      search_blob: p.search_blob
    }))
  };

  inv.manifest_generated_at = new Date().toISOString();
  inv.schema_version = bumpPatchVersion(inv.schema_version);
  return inv;
}

function main() {
  const args = parseArgs(process.argv);
  const inPath = path.resolve(args.in);
  const outPath = path.resolve(args.out);

  const raw = fs.readFileSync(inPath, "utf8");
  const inv = JSON.parse(raw);

  const errors = validateInventory(inv);
  if (errors.length) {
    console.error("VALIDATION ERRORS:");
    for (const e of errors) console.error(" -", e);
    process.exit(1);
  }

  const updated = updateManifest(inv);

  if (args.dry) {
    console.log(JSON.stringify(updated.manifest, null, 2));
    return;
  }

  fs.writeFileSync(outPath, JSON.stringify(updated, null, 2) + "\n", "utf8");
  console.log(`Updated manifest + search_blob. Wrote: ${outPath}`);
  console.log(`New schema_version: ${updated.schema_version}`);
}

main();
