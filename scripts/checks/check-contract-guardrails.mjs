import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ensureNode20, repoRoot } from '../analysis/_shared.mjs';

ensureNode20();

const findings = [];

function readRepoFile(repoPath) {
  return readFileSync(resolve(repoRoot, repoPath), 'utf8');
}

function addFinding(file, message) {
  findings.push({ file, message });
}

function checkNoLocalJsonRpcDeclarations(repoPath) {
  const content = readRepoFile(repoPath);
  if (/interface\s+JsonRpcRequest\b/.test(content)) {
    addFinding(repoPath, 'Local JsonRpcRequest declaration reintroduced; import the shared contract instead.');
  }
  if (/interface\s+JsonRpcResponse\b/.test(content)) {
    addFinding(repoPath, 'Local JsonRpcResponse declaration reintroduced; import the shared contract instead.');
  }
}

function checkSdkWrapper(repoPath) {
  const content = readRepoFile(repoPath).trim();
  const expected = "export * from './src/index.ts';\nexport { default } from './src/index.ts';";
  if (content !== expected) {
    addFinding(
      repoPath,
      'sdk/mod.ts should remain a thin wrapper over sdk/src/index.ts to avoid entrypoint drift.',
    );
  }
}

checkNoLocalJsonRpcDeclarations('api/handlers/mcp.ts');
checkNoLocalJsonRpcDeclarations('api/handlers/platform-mcp.ts');
checkSdkWrapper('sdk/mod.ts');

if (findings.length > 0) {
  console.error('Wave 3 contract guardrails failed:');
  for (const finding of findings) {
    console.error(`- ${finding.file}: ${finding.message}`);
  }
  process.exit(1);
}

console.log('Wave 3 contract guardrails passed.');
