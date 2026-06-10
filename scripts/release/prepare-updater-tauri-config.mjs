import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

const [basePathArg, outputPathArg] = process.argv.slice(2);

if (!basePathArg || !outputPathArg) {
  console.error('Usage: node scripts/release/prepare-updater-tauri-config.mjs <base-config> <output-config>');
  process.exit(1);
}

const basePath = path.resolve(repoRoot, basePathArg);
const outputPath = path.resolve(repoRoot, outputPathArg);
const publicKey = (process.env.TAURI_UPDATER_PUBLIC_KEY || '').trim();
const endpoint = (
  process.env.ULTRALIGHT_UPDATER_ENDPOINT
  || 'https://github.com/evrydayimruslin/ultralight/releases/latest/download/latest.json'
).trim();
const windowsInstallMode = (process.env.ULTRALIGHT_UPDATER_WINDOWS_INSTALL_MODE || 'passive').trim();

if (!publicKey) {
  console.error('[release] TAURI_UPDATER_PUBLIC_KEY must be set before generating the updater release config.');
  process.exit(1);
}

if (!endpoint.startsWith('https://')) {
  console.error(`[release] Updater endpoint must use HTTPS. Received: ${endpoint}`);
  process.exit(1);
}

const config = JSON.parse(await readFile(basePath, 'utf8'));
config.bundle ??= {};
config.bundle.createUpdaterArtifacts = true;

config.plugins ??= {};
const existingUpdater = config.plugins.updater ?? {};
config.plugins.updater = {
  ...existingUpdater,
  pubkey: publicKey,
  endpoints: [endpoint],
  windows: {
    ...(existingUpdater.windows ?? {}),
    installMode: windowsInstallMode,
  },
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

console.log(`[release] Updater-enabled Tauri config written to ${path.relative(repoRoot, outputPath)}`);
