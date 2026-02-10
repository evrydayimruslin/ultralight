// Bundler Service
// Uses esbuild to bundle user code with npm dependencies
// Runs at upload time to create a single self-contained bundle
// MCP-only: no ESM browser bundle generation

// @ts-ignore - Deno is available
const Deno = globalThis.Deno;

export interface BundleResult {
  success: boolean;
  code: string;           // IIFE format for MCP sandbox execution
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
 * - Resolves and inlines ALL imports (npm and relative)
 * - Outputs a single self-contained bundled file
 * - Critical: Data URL imports can't resolve relative paths, so we MUST bundle
 */
export async function bundleCode(
  files: FileInput[],
  entryPoint: string,
): Promise<BundleResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

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
  const hasAnyImports = detectAnyImports(entryFile.content);
  const isTypeScript = entryPoint.endsWith('.ts') || entryPoint.endsWith('.tsx');

  // If no imports AND not TypeScript, return code as-is (no bundling needed)
  // TypeScript files always need transpilation even without imports
  if (!hasAnyImports && !isTypeScript) {
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
    // Write all files to temp directory, transforming npm imports to CDN URLs
    for (const file of files) {
      const filePath = `${tempDir}/${file.name}`;
      const dirPath = filePath.substring(0, filePath.lastIndexOf('/'));

      // Create directories if needed
      if (dirPath !== tempDir) {
        await Deno.mkdir(dirPath, { recursive: true }).catch(() => {});
      }

      // Transform npm imports to esm.sh CDN URLs for Deno compatibility
      const transformedContent = transformNpmImportsToCdn(file.content);
      await Deno.writeTextFile(filePath, transformedContent);
    }

    // Run esbuild via Deno subprocess
    // Use IIFE format - this is critical for sandbox execution via AsyncFunction
    // ESM format produces import statements which AsyncFunction cannot execute
    const entryPath = `${tempDir}/${entryPoint}`;
    const outPath = `${tempDir}/bundle.js`;

    // Detect if this is a React/JSX project (JSX transpilation still needed for MCP code)
    const isReactProject = entryPoint.endsWith('.tsx') || entryPoint.endsWith('.jsx') ||
      files.some(f => f.name.endsWith('.tsx') || f.name.endsWith('.jsx')) ||
      files.some(f => f.content.includes('from "react"') || f.content.includes("from 'react'"));

    const esbuildArgs = [
      'esbuild',
      entryPath,
      '--bundle',
      '--format=iife',  // IIFE format for AsyncFunction compatibility (no import statements)
      '--global-name=__exports',  // Put exports on __exports object so we can extract them
      '--platform=browser',
      '--target=esnext',
      `--outfile=${outPath}`,
      '--minify-syntax',
      '--external:ultralight',
    ];

    // Add JSX support if this looks like a React project
    if (isReactProject) {
      esbuildArgs.push(
        '--jsx=automatic',
        '--jsx-import-source=https://esm.sh/react',
        '--loader:.tsx=tsx',
        '--loader:.jsx=jsx',
      );
    }

    const command = new Deno.Command('npx', {
      args: esbuildArgs,
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

    // Read the IIFE bundled output
    const iifeCode = await Deno.readTextFile(outPath);

    // Post-process: wrap exports for our runtime
    const processedIifeCode = postProcessBundle(iifeCode);

    return {
      success: true,
      code: processedIifeCode,
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
 * Detect if code has ANY imports (relative or external)
 * Used to determine if bundling is needed at all
 */
function detectAnyImports(code: string): boolean {
  // Match any import statement
  const importRegex = /import\s+.*?\s+from\s+['"][^'"]+['"]/;
  const bareImportRegex = /import\s+['"][^'"]+['"]/;

  return importRegex.test(code) || bareImportRegex.test(code);
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
  // Remove any import.meta references that might cause issues
  let processed = code.replace(/import\.meta\.url/g, '"file://ultralight-app"');

  // For IIFE format with --global-name=__exports, the exports are on __exports object.
  // The sandbox will handle extracting these to the execution scope.

  return processed;
}

/**
 * Transform npm package imports to esm.sh CDN URLs
 * This allows Deno/esbuild to fetch packages without npm install
 */
function transformNpmImportsToCdn(code: string): string {
  // Match import statements with npm package names (not relative paths, not URLs)
  const importRegex = /(import\s+(?:[^'"]+\s+from\s+)?['"])([^'"./][^'"]*?)(['"])/g;

  return code.replace(importRegex, (match, prefix, packageName, suffix) => {
    // Skip if already a URL
    if (packageName.startsWith('http://') || packageName.startsWith('https://')) {
      return match;
    }

    // Skip relative imports (shouldn't match due to regex, but be safe)
    if (packageName.startsWith('./') || packageName.startsWith('../')) {
      return match;
    }

    // Skip node: protocol imports
    if (packageName.startsWith('node:')) {
      return match;
    }

    // Transform to esm.sh URL
    return `${prefix}https://esm.sh/${packageName}${suffix}`;
  });
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
      localPath += '.ts';
    }

    const localFile = files.find(f => f.name === localPath || f.name === imp.path + '.js');
    if (localFile) {
      bundledCode = bundledCode.replace(imp.statement, '');
      bundledCode = `// Inlined from ${localPath}\n${localFile.content}\n\n${bundledCode}`;
    }
  }

  return {
    success: true,
    code: bundledCode,
    errors: [],
    warnings: [],
    hasExternalImports: detectExternalImports(entryFile.content),
  };
}
