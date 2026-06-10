import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

const [basePathArg, outputPathArg] = process.argv.slice(2);

if (!basePathArg || !outputPathArg) {
  console.error('Usage: node scripts/release/prepare-windows-tauri-config.mjs <base-config> <output-config>');
  process.exit(1);
}

const basePath = path.resolve(repoRoot, basePathArg);
const outputPath = path.resolve(repoRoot, outputPathArg);
const thumbprint = (process.env.WINDOWS_CERTIFICATE_THUMBPRINT || '').trim();
const timestampUrl = (process.env.WINDOWS_TIMESTAMP_URL || 'http://timestamp.digicert.com').trim();
const digestAlgorithm = (process.env.WINDOWS_DIGEST_ALGORITHM || 'sha256').trim();

if (!thumbprint) {
  console.error('[release] WINDOWS_CERTIFICATE_THUMBPRINT must be set before generating the Windows release config.');
  process.exit(1);
}

const config = JSON.parse(await readFile(basePath, 'utf8'));
config.bundle ??= {};
config.bundle.windows ??= {};
config.bundle.windows = {
  ...config.bundle.windows,
  certificateThumbprint: thumbprint,
  digestAlgorithm,
  timestampUrl,
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

console.log(`[release] Windows Tauri config written to ${path.relative(repoRoot, outputPath)}`);
