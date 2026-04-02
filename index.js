import { cli } from '@jackwener/opencli/registry';
import { registerAwbCommands } from './packages/awb-core/commands.js';

// opencli discovery marker: cli(
registerAwbCommands(cli);
