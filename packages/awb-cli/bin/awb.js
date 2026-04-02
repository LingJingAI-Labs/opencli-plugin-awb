#!/usr/bin/env node
process.env.AWB_COMMAND_PREFIX ??= 'awb';

let standaloneModule;
try {
  standaloneModule = await import('@lingjingai/awb-core/standalone.js');
} catch {
  standaloneModule = await import('../../awb-core/standalone.js');
}

await standaloneModule.runStandaloneCli(process.argv.slice(2));
