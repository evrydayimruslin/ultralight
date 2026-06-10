import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

async function readJson(relativePath) {
  const fullPath = path.join(repoRoot, relativePath);
  return JSON.parse(await readFile(fullPath, 'utf8'));
}

async function readText(relativePath) {
  const fullPath = path.join(repoRoot, relativePath);
  return readFile(fullPath, 'utf8');
}

function parseCargoVersion(cargoToml) {
  const packageSectionMatch = cargoToml.match(/\[package\][\s\S]*?(?=\n\[|$)/);
  if (!packageSectionMatch) {
    throw new Error('Unable to find [package] section in desktop/src-tauri/Cargo.toml');
  }

  const versionMatch = packageSectionMatch[0].match(/^\s*version\s*=\s*"([^"]+)"\s*$/m);
  if (!versionMatch) {
    throw new Error('Unable to find version in desktop/src-tauri/Cargo.toml');
  }

  return versionMatch[1];
}

async function main() {
  const desktopPackage = await readJson('desktop/package.json');
  const tauriConfig = await readJson('desktop/src-tauri/tauri.conf.json');
  const cargoToml = await readText('desktop/src-tauri/Cargo.toml');
  const cargoVersion = parseCargoVersion(cargoToml);

  const versions = {
    'desktop/package.json': desktopPackage.version,
    'desktop/src-tauri/tauri.conf.json': tauriConfig.version,
    'desktop/src-tauri/Cargo.toml': cargoVersion,
  };

  const uniqueVersions = [...new Set(Object.values(versions))];
  if (uniqueVersions.length !== 1) {
    console.error('[release] Desktop version mismatch detected:');
    for (const [file, version] of Object.entries(versions)) {
      console.error(`  - ${file}: ${version}`);
    }
    process.exit(1);
  }

  const version = uniqueVersions[0];
  const tagName = process.env.GITHUB_REF_NAME ?? process.argv[2];
  if (tagName) {
    const expectedTag = `v${version}`;
    if (tagName !== expectedTag) {
      console.error(`[release] Tag/version mismatch. Expected ${expectedTag} from desktop version ${version}, received ${tagName}.`);
      process.exit(1);
    }
  }

  console.log(`[release] Desktop version verified: ${version}`);
}

await main();
