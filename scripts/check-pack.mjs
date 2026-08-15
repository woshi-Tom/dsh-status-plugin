/**
 * Tarball integrity check for the published package.
 *
 * The 0.2.0 release shipped without lib/cpu.js and lib/auth.js while
 * lib/index.js, lib/alerts.js and lib/status.js import them, so the plugin
 * crashed with ERR_MODULE_NOT_FOUND right after install. This script runs
 * `npm pack --dry-run --json` and verifies that every local module referenced
 * by a relative import inside lib/ is actually present in the tarball.
 *
 * Usage: node scripts/check-pack.mjs   (run after `pnpm run build`)
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';

/** Recursively collect every .js file under a directory. */
function collectJsFiles(root, dir = root, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      collectJsFiles(root, full, out);
    } else if (entry.endsWith('.js')) {
      out.push(full);
    }
  }
  return out;
}

/** Extract local relative module specifiers from one module's source. */
function relativeSpecifiers(source) {
  const specifiers = [];
  const pattern = /(?:from\s+|import\s*\(?\s*|export\s+\*\s+from\s+|import\s+)['"]([^'"]+)['"]/g;
  for (const match of source.matchAll(pattern)) {
    const specifier = match[1];
    if (specifier.startsWith('./') || specifier.startsWith('../')) {
      specifiers.push(specifier);
    }
  }
  return specifiers;
}

/** True when the specifier resolves to an existing file under lib/. */
function resolveSpecifier(fromFile, specifier) {
  const resolved = resolve(dirname(fromFile), specifier);
  if (!resolved.startsWith(resolve('lib') + sep)) return null;
  return relative(process.cwd(), resolved).split(sep).join('/');
}

// npm pack only stages local files (no registry access), so a throwaway cache
// keeps the check working even when the user's default npm cache is broken.
const cacheDir = mkdtempSync(join(tmpdir(), 'dsh-pack-check-'));
const tarball = JSON.parse(
  execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts', '--cache', cacheDir], {
    encoding: 'utf8',
    cwd: process.cwd(),
  }),
);
const packed = new Set(tarball[0].files.map(entry => entry.path));
const packedNames = [...packed].sort();

let failed = false;
const missing = [];
for (const file of collectJsFiles('lib')) {
  const source = readFileSync(file, 'utf8');
  for (const specifier of relativeSpecifiers(source)) {
    const target = resolveSpecifier(file, specifier);
    if (target === null) continue;
    if (!packed.has(target)) {
      missing.push(`${file} imports ${specifier} -> ${target}`);
    }
  }
}

if (missing.length > 0) {
  failed = true;
  console.error('CHECK FAILED: tarball is missing modules imported at runtime:');
  for (const line of missing) console.error(`  - ${line}`);
}

for (const required of ['lib/index.js', 'lib/client.js', 'cordis.patch.yml', 'package.json', 'README.md']) {
  if (!packed.has(required)) {
    failed = true;
    console.error(`CHECK FAILED: tarball is missing required file ${required}`);
  }
}

console.log(`pack check: ${packedNames.length} files in tarball, ${missing.length} dangling imports`);
if (failed) process.exit(1);
console.log('pack check: OK');
