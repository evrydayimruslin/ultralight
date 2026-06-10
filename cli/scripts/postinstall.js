#!/usr/bin/env node

/**
 * Post-install script for ultralightpro
 * Simple success message — setup command runs in pure Node.js, no extra deps needed.
 */

console.log(`
✓ Ultralight CLI installed.

Get started:
  ultralight setup --token <your-token>    Connect to Ultralight
  ultralight --help                        Show all commands
`);
