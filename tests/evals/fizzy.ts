#!/usr/bin/env bun
// Deliberately independent of runner.ts, env-loader.ts and AgentExecutor.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { bootstrapFizzy, FIZZY_FIXTURE, preflightFizzy, prepareFizzyFixture } from './fizzy-fixture.js';

const [action, output, archive] = process.argv.slice(2);
if (!output || !['download', 'prepare', 'preflight', 'bootstrap'].includes(action)) {
  throw new Error(
    'Usage: bun tests/evals/fizzy.ts download <new-archive> | prepare <new-directory> <archive> | preflight <directory> | bootstrap <prepared-directory>',
  );
}
if (action === 'download') {
  const response = await fetch(FIZZY_FIXTURE.archiveUrl);
  if (!response.ok) throw new Error(`Source download failed: ${response.status}`);
  await writeFile(resolve(output), new Uint8Array(await response.arrayBuffer()), { flag: 'wx' });
} else if (action === 'prepare') {
  if (!archive) throw new Error('prepare requires a local pinned archive');
  await mkdir(resolve(output)); // Refuse all existing directories, not just nonempty ones.
  console.log(await prepareFizzyFixture(resolve(output), resolve(archive)));
} else if (action === 'preflight') {
  const result = await preflightFizzy(resolve(output));
  console.log(JSON.stringify(result, null, 2));
  if (!result.runtimeAvailable || !result.prepared) process.exitCode = 1;
} else {
  await bootstrapFizzy(resolve(output));
}
