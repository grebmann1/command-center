#!/usr/bin/env node
/**
 * Package the built cu extension into its committed, runnable artifact dir and
 * (best-effort) seed it into the dev install dir so a fresh `npm run dev` shows
 * the Fleet board through the disk pipeline.
 *
 * Sources:  extensions/cu/extension.json + extensions/cu/dist/{main.js,renderer.js}
 * Targets:
 *   1. examples/extensions/cu/   — COMMITTED runnable artifact (mirrors `gus`).
 *      This is the canonical shipped form of the extension.
 *   2. ~/.cc-center/extensions/cu/  — the dev/runtime install dir the discovery
 *      scanner reads (unless CC_EXTENSIONS_DIR overrides it). Seeded so a local
 *      `npm run dev` loads cu without a manual copy. Skipped if the home dir
 *      isn't writable (e.g. CI) — the committed examples copy is the source of
 *      truth either way.
 *
 * Run after `npm run build` (the package.json `package` script does both).
 */
import { cp, mkdir, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const extRoot = join(__dirname, '..');
const repoRoot = join(extRoot, '..', '..');
const dist = join(extRoot, 'dist');
const manifest = join(extRoot, 'extension.json');

const FILES = ['main.mjs', 'renderer.js'];

async function copyInto(targetDir) {
  await mkdir(targetDir, { recursive: true });
  await cp(manifest, join(targetDir, 'extension.json'));
  for (const f of FILES) {
    await cp(join(dist, f), join(targetDir, f));
  }
}

async function main() {
  // Verify the build ran.
  for (const f of FILES) {
    try {
      await access(join(dist, f));
    } catch {
      console.error(`missing dist/${f} — run \`npm run build\` first`);
      process.exit(1);
    }
  }

  // 1. Committed artifact.
  const examplesDir = join(repoRoot, 'examples', 'extensions', 'cu');
  await copyInto(examplesDir);
  console.log(`packaged → ${examplesDir}`);

  // 2. Dev install dir (best-effort).
  const installRoot = process.env.CC_EXTENSIONS_DIR ?? join(homedir(), '.cc-center', 'extensions');
  try {
    await copyInto(join(installRoot, 'cu'));
    console.log(`seeded   → ${join(installRoot, 'cu')}`);
  } catch (err) {
    console.warn(`skipped dev seed (${err instanceof Error ? err.message : String(err)})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
