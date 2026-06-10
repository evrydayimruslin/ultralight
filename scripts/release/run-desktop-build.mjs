import { spawn } from 'node:child_process';

const requestedChannel = (process.env.ULTRALIGHT_DESKTOP_BUILD_CHANNEL || 'production').trim().toLowerCase();
const allowedChannels = new Set(['production', 'staging']);

if (!allowedChannels.has(requestedChannel)) {
  console.error(`[release] Unsupported ULTRALIGHT_DESKTOP_BUILD_CHANNEL "${requestedChannel}". Expected production or staging.`);
  process.exit(1);
}

const scriptName = requestedChannel === 'staging' ? 'build:staging' : 'build:production';

console.log(`[release] Building desktop frontend for ${requestedChannel} using pnpm run ${scriptName}`);

const child = spawn('pnpm', ['run', scriptName], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: process.env,
});

child.on('exit', (code, signal) => {
  if (signal) {
    console.error(`[release] Desktop frontend build terminated by signal ${signal}`);
    process.exit(1);
  }
  process.exit(code ?? 1);
});
