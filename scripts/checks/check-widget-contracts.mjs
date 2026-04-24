import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { ensureNode20, repoRoot } from '../analysis/_shared.mjs';

ensureNode20();

const findings = [];

function walkForManifests(directory) {
  const results = [];

  for (const entry of readdirSync(directory)) {
    const fullPath = resolve(directory, entry);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...walkForManifests(fullPath));
      continue;
    }

    if (entry === 'manifest.json') {
      results.push(fullPath);
    }
  }

  return results;
}

function addFinding(file, message) {
  findings.push({ file, message });
}

const manifestPaths = walkForManifests(resolve(repoRoot, 'apps'));

for (const manifestPath of manifestPaths) {
  const relativePath = relative(repoRoot, manifestPath).replaceAll('\\', '/');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const widgets = Array.isArray(manifest.widgets) ? manifest.widgets : [];
  const functions = manifest.functions && typeof manifest.functions === 'object' ? manifest.functions : {};

  for (const widget of widgets) {
    if (!widget || typeof widget !== 'object') {
      addFinding(relativePath, 'Widget declarations must be objects.');
      continue;
    }

    const widgetId = typeof widget.id === 'string' ? widget.id : '';
    const dataTool = typeof widget.data_tool === 'string' ? widget.data_tool : null;
    if (!widgetId) {
      addFinding(relativePath, 'Widget declarations must include a string `id` field.');
      continue;
    }

    const expectedDataTool = `widget_${widgetId}_data`;
    if (dataTool !== null && dataTool !== expectedDataTool) {
      addFinding(
        relativePath,
        `Widget \`${widgetId}\` should declare \`${expectedDataTool}\` as its data_tool instead of \`${dataTool}\`.`,
      );
    }

    const uiFunction = `widget_${widgetId}_ui`;
    if (!functions[uiFunction]) {
      addFinding(relativePath, `Widget \`${widgetId}\` is missing its canonical UI function \`${uiFunction}\`.`);
    }

    if (!functions[expectedDataTool]) {
      addFinding(
        relativePath,
        `Widget \`${widgetId}\` is missing its canonical data function \`${expectedDataTool}\`.`,
      );
    }
  }
}

if (findings.length > 0) {
  console.error('Widget contract guardrails failed:');
  for (const finding of findings) {
    console.error(`- ${finding.file}: ${finding.message}`);
  }
  process.exit(1);
}

console.log('Widget contract guardrails passed.');
