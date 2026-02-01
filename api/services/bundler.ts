// Bundler Service
// Uses esbuild to bundle user code with npm dependencies
// Runs at upload time to create a single self-contained bundle

// @ts-ignore - Deno is available
const Deno = globalThis.Deno;

export interface BundleResult {
  success: boolean;
  code: string;
  errors: string[];
  warnings: string[];
  hasExternalImports: boolean;
}

export interface FileInput {
  name: string;
  content: string;
}

/**
 * Bundle user code using esbuild
 * - Resolves and inlines npm imports
 * - Handles local file imports
 * - Outputs a single bundled file
 */
export async function bundleCode(
  files: FileInput[],
  entryPoint: string,
): Promise<BundleResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check if code has external imports
  const entryFile = files.find(f => f.name === entryPoint);
  if (!entryFile) {
    return {
      success: false,
      code: '',
      errors: [`Entry point not found: ${entryPoint}`],
      warnings: [],
      hasExternalImports: false,
    };
  }

  const hasExternalImports = detectExternalImports(entryFile.content);

  // If no external imports, skip bundling (faster)
  if (!hasExternalImports) {
    return {
      success: true,
      code: entryFile.content,
      errors: [],
      warnings: [],
      hasExternalImports: false,
    };
  }

  // Create a temporary directory for the build
  const tempDir = await Deno.makeTempDir({ prefix: 'ultralight-build-' });

  try {
    // Write all files to temp directory
    for (const file of files) {
      const filePath = `${tempDir}/${file.name}`;
      const dirPath = filePath.substring(0, filePath.lastIndexOf('/'));

      // Create directories if needed
      if (dirPath !== tempDir) {
        await Deno.mkdir(dirPath, { recursive: true }).catch(() => {});
      }

      await Deno.writeTextFile(filePath, file.content);
    }

    // Create a minimal package.json if not present
    const hasPackageJson = files.some(f => f.name === 'package.json');
    if (!hasPackageJson) {
      await Deno.writeTextFile(`${tempDir}/package.json`, JSON.stringify({
        name: 'ultralight-app',
        type: 'module',
        dependencies: {},
      }));
    }

    // Run esbuild via Deno subprocess
    const entryPath = `${tempDir}/${entryPoint}`;
    const outPath = `${tempDir}/bundle.js`;

    const command = new Deno.Command('npx', {
      args: [
        'esbuild',
        entryPath,
        '--bundle',
        '--format=esm',
        '--platform=neutral',
        '--target=esnext',
        `--outfile=${outPath}`,
        '--minify-syntax',
        // Don't bundle these - they're provided by the runtime
        '--external:ultralight',
      ],
      cwd: tempDir,
      stdout: 'piped',
      stderr: 'piped',
    });

    const process = command.spawn();
    const { code: exitCode, stdout, stderr } = await process.output();

    const stdoutText = new TextDecoder().decode(stdout);
    const stderrText = new TextDecoder().decode(stderr);

    if (stderrText) {
      // Parse esbuild output for errors/warnings
      const lines = stderrText.split('\n').filter(Boolean);
      for (const line of lines) {
        if (line.includes('error')) {
          errors.push(line);
        } else if (line.includes('warning')) {
          warnings.push(line);
        }
      }
    }

    if (exitCode !== 0) {
      return {
        success: false,
        code: '',
        errors: errors.length > 0 ? errors : [`Build failed with exit code ${exitCode}`],
        warnings,
        hasExternalImports: true,
      };
    }

    // Read the bundled output
    const bundledCode = await Deno.readTextFile(outPath);

    // Post-process: wrap exports for our runtime
    const processedCode = postProcessBundle(bundledCode);

    return {
      success: true,
      code: processedCode,
      errors: [],
      warnings,
      hasExternalImports: true,
    };

  } catch (err) {
    errors.push(err instanceof Error ? err.message : String(err));
    return {
      success: false,
      code: '',
      errors,
      warnings,
      hasExternalImports,
    };
  } finally {
    // Cleanup temp directory
    await Deno.remove(tempDir, { recursive: true }).catch(() => {});
  }
}

/**
 * Detect if code has external (npm) imports
 */
function detectExternalImports(code: string): boolean {
  // Match import statements that aren't relative paths
  const importRegex = /import\s+.*?\s+from\s+['"]([^'"]+)['"]/g;
  let match;

  while ((match = importRegex.exec(code)) !== null) {
    const importPath = match[1];

    // Skip relative imports
    if (importPath.startsWith('./') || importPath.startsWith('../')) {
      continue;
    }

    // Skip Deno std library (we'll handle these separately if needed)
    if (importPath.startsWith('https://deno.land/')) {
      continue;
    }

    // This is an npm/external import
    return true;
  }

  // Also check for require() calls
  if (/require\s*\(\s*['"][^'"]+['"]\s*\)/.test(code)) {
    return true;
  }

  return false;
}

/**
 * Post-process bundled code for our runtime
 */
function postProcessBundle(code: string): string {
  // esbuild outputs ESM format which should work with our runtime
  // Add any necessary transformations here

  // Remove any import.meta references that might cause issues
  let processed = code.replace(/import\.meta\.url/g, '"file://ultralight-app"');

  // Ensure we're not breaking the runtime's ultralight injection
  // The bundled code should reference `ultralight` which we inject

  return processed;
}

/**
 * Quick bundle using in-memory transformation (no esbuild)
 * For simple cases without npm dependencies
 */
export function quickBundle(files: FileInput[], entryPoint: string): BundleResult {
  const entryFile = files.find(f => f.name === entryPoint);

  if (!entryFile) {
    return {
      success: false,
      code: '',
      errors: [`Entry point not found: ${entryPoint}`],
      warnings: [],
      hasExternalImports: false,
    };
  }

  // For now, just concatenate local imports
  // This is a simplified version - full bundling uses esbuild
  let bundledCode = entryFile.content;

  // Find local imports and inline them
  const localImportRegex = /import\s+(\{[^}]+\}|\*\s+as\s+\w+|\w+)\s+from\s+['"]\.\/([^'"]+)['"]/g;
  const imports: Array<{ statement: string; path: string }> = [];

  let match;
  while ((match = localImportRegex.exec(entryFile.content)) !== null) {
    imports.push({ statement: match[0], path: match[2] });
  }

  // Inline local files (simple approach)
  for (const imp of imports) {
    let localPath = imp.path;
    if (!localPath.endsWith('.ts') && !localPath.endsWith('.js')) {
      localPath += '.ts'; // Default to .ts
    }

    const localFile = files.find(f => f.name === localPath || f.name === imp.path + '.js');
    if (localFile) {
      // Remove the import statement and prepend the file content
      bundledCode = bundledCode.replace(imp.statement, '');
      bundledCode = `// Inlined from ${localPath}\n${localFile.content}\n\n${bundledCode}`;
    }
  }

  return {
    success: true,
    code: bundledCode,
    errors: [],
    warnings: [],
    hasExternalImports: false,
  };
}
