#!/usr/bin/env node
import os from 'node:os';
import path from 'node:path';

process.env.AWB_STATE_DIR ??= path.join(os.homedir(), '.lingjingai', 'awb');
process.env.AWB_AUTH_PATH ??= path.join(process.env.AWB_STATE_DIR, 'auth.json');
process.env.AWB_STATE_PATH ??= path.join(process.env.AWB_STATE_DIR, 'state.json');

let standaloneModule;
try {
  standaloneModule = await import('@lingjingai/awb-core/standalone.js');
} catch {
  standaloneModule = await import('../../awb-core/standalone.js');
}

await standaloneModule.runStandaloneCli(process.argv.slice(2));
