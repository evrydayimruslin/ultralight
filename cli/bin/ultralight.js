#!/usr/bin/env node

/**
 * Ultralight CLI - npm wrapper
 *
 * This is a thin wrapper that invokes the Deno CLI.
 * The actual CLI is written in Deno/TypeScript for consistency with the platform.
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { existsSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Check if Deno is installed
function checkDeno() {
  return new Promise((resolve) => {
    const proc = spawn('deno', ['--version'], { stdio: 'pipe' });
    proc.on('close', (code) => resolve(code === 0));
    proc.on('error', () => resolve(false));
  });
}

// Get the CLI source URL or local path
function getCliSource() {
  // Check for local development
  const localPath = join(__dirname, '..', 'mod.ts');
  if (existsSync(localPath)) {
    return localPath;
  }

  // Use remote URL for published package
  return 'https://ultralight.dev/cli/mod.ts';
}

async function main() {
  const hasDeno = await checkDeno();

  if (!hasDeno) {
    console.error(`
Ultralight CLI requires Deno to be installed.

Install Deno:
  curl -fsSL https://deno.land/install.sh | sh

Or visit: https://deno.land/#installation

After installing Deno, run this command again.
`);
    process.exit(1);
  }

  const cliSource = getCliSource();
  const args = process.argv.slice(2);

  const proc = spawn('deno', [
    'run',
    '--allow-net',
    '--allow-read',
    '--allow-write',
    '--allow-env',
    cliSource,
    ...args
  ], {
    stdio: 'inherit',
    env: process.env
  });

  proc.on('close', (code) => {
    process.exit(code || 0);
  });

  proc.on('error', (err) => {
    console.error('Failed to start Ultralight CLI:', err.message);
    process.exit(1);
  });
}

main();
