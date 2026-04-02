#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';

const version = process.argv[2];

if (!version || !/^\d+\.\d+\.\d+(?:[-+].+)?$/.test(version)) {
  process.stderr.write('Usage: node scripts/sync-versions.mjs <version>\n');
  process.exit(1);
}

const rootDir = process.cwd();
const packageFiles = [
  path.join(rootDir, 'package.json'),
  path.join(rootDir, 'packages', 'awb-core', 'package.json'),
  path.join(rootDir, 'packages', 'awb-cli', 'package.json'),
];

for (const filePath of packageFiles) {
  const data = JSON.parse(await fs.readFile(filePath, 'utf8'));
  data.version = version;
  if (data.dependencies?.['@lingjingai/awb-core']) {
    data.dependencies['@lingjingai/awb-core'] = version;
  }
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  process.stdout.write(`updated ${path.relative(rootDir, filePath)} -> ${version}\n`);
}
