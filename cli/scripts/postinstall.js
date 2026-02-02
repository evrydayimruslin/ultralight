#!/usr/bin/env node

/**
 * Post-install script for @ultralight/cli
 * Checks for Deno and provides installation instructions if needed
 */

import { spawn } from 'child_process';

function checkDeno() {
  return new Promise((resolve) => {
    const proc = spawn('deno', ['--version'], { stdio: 'pipe' });
    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

async function main() {
  const hasDeno = await checkDeno();

  if (!hasDeno) {
    console.log(`
╔════════════════════════════════════════════════════════════════╗
║                     Ultralight CLI                             ║
╠════════════════════════════════════════════════════════════════╣
║                                                                ║
║  Deno is required but not found in your PATH.                  ║
║                                                                ║
║  Install Deno:                                                 ║
║    curl -fsSL https://deno.land/install.sh | sh                ║
║                                                                ║
║  Or visit: https://deno.land/#installation                     ║
║                                                                ║
║  After installing, you can use:                                ║
║    ultralight --help                                           ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
`);
  } else {
    console.log(`
✓ Ultralight CLI installed successfully!

Get started:
  ultralight --help        Show available commands
  ultralight login         Authenticate with Ultralight
  ultralight upload        Upload an app
`);
  }
}

main();
