Your Resume inventory, to be used as a knowledge base in GPTs/LLMs.

## What’s inside
- `res/inventory.json`: your roles and projects in one file.
- `res/system_instructions.txt`: your desired system instruction for the LLM to follow.
- `scripts/update_manifest.js`: keep the manifest section of the `inventory.json` updated.

## Quick start
1) Clone this repo.  
2) Swap in your data in `res/inventory.json` (same fields; do not touch `manifest`).  
3) Run `pnpm inventory:index` (or `node scripts/update_manifest.js --in res/inventory.json --out res/inventory.json`).  
4) Use `res/inventory.json` as your resume inventory or knowledge base for job applications.

## Why it helps
- One clean source, no copy-paste drift.
- Stays current: rerun the command after edits (`--dry` to preview).
- Easy to hand to recruiters or AI tools.
