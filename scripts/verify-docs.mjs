#!/usr/bin/env node
/**
 * Documentation drift guard (Phase 23).
 *
 * Every claim a document makes about the code is a claim that can rot. This script checks the
 * mechanical ones - the API route list, the environment variables, the prompt version ids and the
 * documents other documents point at - so a refactor that forgets a document fails here instead of
 * being discovered by a reader.
 *
 * Run with `npm run verify:docs`. Exit code 1 means a real drift, not a style preference.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const failures = [];
const warnings = [];

function fail(check, message) {
  failures.push(`${check}: ${message}`);
}

function warn(check, message) {
  warnings.push(`${check}: ${message}`);
}

function read(path) {
  return readFileSync(join(root, path), 'utf8');
}

/* -------------------------------------------------------------------------- */
/* 1. API routes documented vs registered                                     */
/* -------------------------------------------------------------------------- */

function registeredRoutes() {
  const routesDir = join(root, 'apps/api/src/routes');
  const index = read('apps/api/src/routes/index.ts');

  // `apiRouter.use('/screening', screeningRouter)` -> { screeningRouter: '/screening' }
  const mounts = new Map();
  for (const match of index.matchAll(/apiRouter\.use\(\s*'([^']*)',\s*(\w+)/g)) {
    mounts.set(match[2], match[1]);
  }

  const routes = new Set();
  for (const file of readdirSync(routesDir).filter((name) => name.endsWith('.routes.ts'))) {
    const source = readFileSync(join(routesDir, file), 'utf8');
    const routerName = `${file.replace('.routes.ts', '')}Router`;
    const prefix = mounts.get(routerName);
    if (prefix === undefined) {
      warn('routes', `${file} is not mounted in routes/index.ts`);
      continue;
    }

    for (const match of source.matchAll(/\.(get|post|put|patch|delete)\(\s*'([^']*)'/g)) {
      const path = match[2] === '/' ? '' : match[2];
      routes.add(`${match[1].toUpperCase()} /api${prefix}${path}`);
    }
  }
  return routes;
}

function documentedRoutes() {
  const apiDoc = read('docs/API.md');
  const routes = new Set();
  const method = /\b(GET|POST|PUT|PATCH|DELETE)\b/;

  for (const line of apiDoc.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').map((cell) => cell.trim());
    const methodCell = cells.find((cell) => /^(GET|POST|PUT|PATCH|DELETE)$/.test(cell));
    if (!methodCell || !method.test(methodCell)) continue;

    for (const cell of cells) {
      const path = cell.replace(/`/g, '');
      if (!path.startsWith('/')) continue;
      routes.add(`${methodCell} /api${path}`);
    }
  }
  return routes;
}

const codeRoutes = registeredRoutes();
const docRoutes = documentedRoutes();

for (const route of codeRoutes) {
  if (!docRoutes.has(route)) fail('docs/API.md', `${route} is registered but not documented`);
}
for (const route of docRoutes) {
  if (!codeRoutes.has(route)) fail('docs/API.md', `${route} is documented but not registered`);
}

/* -------------------------------------------------------------------------- */
/* 2. Environment variables: schema vs .env.example                           */
/* -------------------------------------------------------------------------- */

function schemaKeys() {
  const source = read('apps/api/src/config/env.ts');
  const start = source.indexOf('const envSchema');
  const end = source.indexOf('const parsed', start);
  const block = source.slice(start, end === -1 ? source.length : end);

  return new Set([...block.matchAll(/^\s{2}([A-Z][A-Z0-9_]*):/gm)].map((match) => match[1]));
}

function exampleKeys() {
  const source = read('.env.example');
  return new Set([...source.matchAll(/^\s*([A-Z][A-Z0-9_]*)=/gm)].map((match) => match[1]));
}

/**
 * Variables that legitimately have no entry in the API schema.
 *
 * `VITE_*` keys are inlined by Vite into the browser bundle and `PUPPETEER_SKIP_DOWNLOAD` is read
 * by the installer, so none of them belongs in `apps/api/src/config/env.ts`. Each exception is
 * verified below rather than trusted.
 */
const NON_API_ENV_KEYS = new Map([
  ['VITE_API_BASE_URL', 'inlined by Vite for the browser build'],
  ['VITE_SUPABASE_URL', 'inlined by Vite for the browser build'],
  ['VITE_SUPABASE_ANON_KEY', 'inlined by Vite for the browser build'],
  ['PUPPETEER_SKIP_DOWNLOAD', 'read by the puppeteer installer, not by the API runtime'],
]);

/** Vite only inlines `VITE_`-prefixed keys, so their absence from the API schema is expected. */
function usedByTheWebApp(key) {
  const files = [
    'apps/web/vite.config.ts',
    'apps/web/src/lib/supabase.ts',
    'apps/web/src/lib/api.ts',
  ];
  return files.some((file) => {
    const absolute = join(root, file);
    return existsSync(absolute) && readFileSync(absolute, 'utf8').includes(key);
  });
}

const schema = schemaKeys();
const example = exampleKeys();

for (const key of example) {
  if (NON_API_ENV_KEYS.has(key)) {
    if (key.startsWith('VITE_') && !usedByTheWebApp(key)) {
      fail('.env.example', `${key} is documented as a browser variable but no web file reads it`);
    }
    continue;
  }
  if (!schema.has(key)) fail('.env.example', `${key} is not read by apps/api/src/config/env.ts`);
}
for (const key of schema) {
  if (!example.has(key)) warn('.env.example', `${key} exists in the schema but has no placeholder`);
}

/* -------------------------------------------------------------------------- */
/* 3. Prompt versions: registry vs the prompt document                        */
/* -------------------------------------------------------------------------- */

const versionRegistry = read('apps/api/src/prompts/types.ts');
const promptDoc = read('docs/AI_PROMPTS.md');
const versions = [...versionRegistry.matchAll(/'([A-Z_]+_V\d+)'/g)].map((match) => match[1]);

for (const version of new Set(versions)) {
  if (!promptDoc.includes(version)) {
    fail('docs/AI_PROMPTS.md', `${version} is registered but missing from the version table`);
  }
}

/* -------------------------------------------------------------------------- */
/* 4. Referenced documents exist                                              */
/* -------------------------------------------------------------------------- */

for (const file of ['README.md', 'PROJECT_CONTEXT.md']) {
  const source = read(file);
  for (const match of source.matchAll(/docs\/([A-Za-z0-9_.-]+\.md)/g)) {
    const referenced = `docs/${match[1]}`;
    if (!existsSync(join(root, referenced)))
      fail(file, `references ${referenced}, which does not exist`);
  }
}

// An orphan document is an invisible one: every file in docs/ must be pointed at from somewhere.
const docsDir = join(root, 'docs');
const docFiles = readdirSync(docsDir).filter((name) => name.endsWith('.md'));
const referencedDocs = new Set();

for (const source of [
  'README.md',
  'PROJECT_CONTEXT.md',
  ...docFiles.map((name) => `docs/${name}`),
]) {
  const absolute = join(root, source);
  if (!existsSync(absolute)) continue;
  for (const match of readFileSync(absolute, 'utf8').matchAll(/docs\/([A-Za-z0-9_.-]+\.md)/g)) {
    referencedDocs.add(match[1]);
  }
}

for (const doc of docFiles) {
  if (!referencedDocs.has(doc)) fail('docs/', `${doc} is not referenced from any other document`);
}

/* -------------------------------------------------------------------------- */
/* Report                                                                     */
/* -------------------------------------------------------------------------- */

if (warnings.length > 0) {
  console.log(`Documentation drift warnings (${warnings.length}):`);
  for (const entry of warnings) console.log(`  ~ ${entry}`);
}

if (failures.length > 0) {
  console.error(`Documentation drift found (${failures.length}):`);
  for (const entry of failures) console.error(`  ! ${entry}`);
  process.exit(1);
}

console.log(
  `Documentation matches the code: ${codeRoutes.size} routes, ${schema.size} env keys, ${new Set(versions).size} prompt versions.`,
);
