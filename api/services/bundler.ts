// Bundler Service
// Uses esbuild to bundle user code with npm dependencies
// Runs at upload time to create a single self-contained bundle

// @ts-ignore - Deno is available
const Deno = globalThis.Deno;

export interface BundleResult {
  success: boolean;
  code: string;           // IIFE format for MCP sandbox execution
  esmCode?: string;       // ESM format for browser UI rendering
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

    // Detect if this is a React/JSX project
    const isReactProject = entryPoint.endsWith('.tsx') || entryPoint.endsWith('.jsx') ||
      files.some(f => f.name.endsWith('.tsx') || f.name.endsWith('.jsx')) ||
      files.some(f => f.content.includes('from "react"') || f.content.includes("from 'react'"));

    const esbuildArgs = [
      'esbuild',
      entryPath,
      '--bundle',
      '--format=iife',  // IIFE format for AsyncFunction compatibility (no import statements)
      '--global-name=__exports',  // Put exports on __exports object so we can extract them
      '--platform=browser',  // Use browser platform for client-side apps
      '--target=esnext',
      `--outfile=${outPath}`,
      '--minify-syntax',
      // Don't bundle these - they're provided by the runtime or loaded separately
      '--external:ultralight',
      // React/ReactDOM are loaded separately in browser via esm.sh import map
      // Marking as external prevents "Dynamic require" errors when running MCP functions in sandbox
      '--external:react',
      '--external:react-dom',
      '--external:react-dom/client',
      '--external:https://esm.sh/react*',
      '--external:https://esm.sh/react-dom*',
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

    // Now build ESM version for browser UI
    const esmOutPath = `${tempDir}/bundle.esm.js`;
    const esmEsbuildArgs = [
      'esbuild',
      entryPath,
      '--bundle',
      '--format=esm',  // ESM format for browser dynamic import()
      '--platform=browser',
      '--target=esnext',
      `--outfile=${esmOutPath}`,
      '--minify-syntax',
      '--external:ultralight',
      '--external:react',
      '--external:react-dom',
      '--external:react-dom/client',
      '--external:https://esm.sh/react*',
      '--external:https://esm.sh/react-dom*',
    ];

    if (isReactProject) {
      esmEsbuildArgs.push(
        '--jsx=automatic',
        // Use full esm.sh URL for JSX runtime - import maps don't work with Blob URLs
        '--jsx-import-source=https://esm.sh/react@18',
        '--loader:.tsx=tsx',
        '--loader:.jsx=jsx',
      );
    }

    const esmCommand = new Deno.Command('npx', {
      args: esmEsbuildArgs,
      cwd: tempDir,
      stdout: 'piped',
      stderr: 'piped',
    });

    const esmProcess = esmCommand.spawn();
    const { code: esmExitCode } = await esmProcess.output();

    let esmCode: string | undefined;
    if (esmExitCode === 0) {
      esmCode = await Deno.readTextFile(esmOutPath);
      // Post-process ESM code and transform bare specifiers to full URLs
      // This is critical because Blob URL imports don't use import maps
      esmCode = postProcessBundle(esmCode);
      esmCode = transformBareSpecifiersToUrls(esmCode);
    }

    return {
      success: true,
      code: processedIifeCode,
      esmCode,
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
 *
 * IIFE bundles with --global-name=__exports produce code like:
 * var __exports = (() => { ... return { funcA, funcB }; })();
 *
 * We need to extract those exports so they're accessible as top-level variables
 * for the sandbox's AsyncFunction execution context.
 *
 * The sandbox wrapper looks like:
 * ```
 * "use strict";
 * ${bundledCode}       <- this is what we're post-processing
 * return functionName(...args);
 * ```
 *
 * So we need exports to be available as variables at that scope level.
 * We achieve this by dynamically assigning __exports properties to the
 * function's scope using eval-free techniques.
 */
function postProcessBundle(code: string): string {
  // Remove any import.meta references that might cause issues
  let processed = code.replace(/import\.meta\.url/g, '"file://ultralight-app"');

  // For IIFE format with --global-name=__exports, the exports are on __exports object.
  // The sandbox will handle extracting these to the execution scope.
  // We don't need to do anything extra here - the sandbox wrapper will be updated
  // to handle __exports.

  return processed;
}

/**
 * Transform bare specifier imports to full esm.sh URLs
 * This is CRITICAL for ESM code that will be loaded via Blob URLs,
 * because import maps don't apply to Blob URL origins.
 *
 * Transforms imports like:
 *   import { jsx } from "react/jsx-runtime"
 *   -> import { jsx } from "https://esm.sh/react@18/jsx-runtime"
 *
 *   import React from "react"
 *   -> import React from "https://esm.sh/react@18"
 *
 * IMPORTANT: Must NOT match already-transformed URLs like "https://esm.sh/react"
 */
function transformBareSpecifiersToUrls(code: string): string {
  // Transform react and react-dom imports to pinned esm.sh URLs
  // Using @18 to pin to React 18.x for consistency
  let result = code;

  // Strategy: Use negative lookbehind to avoid matching URLs that already have esm.sh
  // But since JS doesn't have great lookbehind support in all environments,
  // we'll use a different approach: match the full import statement and only transform
  // if the specifier is a bare specifier (no http/https prefix)

  // Handle dynamic imports: import("react") -> import("https://esm.sh/react@18")
  // Only match if NOT preceded by esm.sh/
  result = result.replace(
    /import\s*\(\s*["']react["']\s*\)/g,
    'import("https://esm.sh/react@18")'
  );
  result = result.replace(
    /import\s*\(\s*["']react-dom["']\s*\)/g,
    'import("https://esm.sh/react-dom@18")'
  );
  result = result.replace(
    /import\s*\(\s*["']react-dom\/client["']\s*\)/g,
    'import("https://esm.sh/react-dom@18/client")'
  );

  // First pass: Fix any esm.sh URLs that are missing version pins
  // e.g., "https://esm.sh/react" -> "https://esm.sh/react@18"
  // e.g., "https://esm.sh/react-dom/client" -> "https://esm.sh/react-dom@18/client"
  result = result.replace(
    /https:\/\/esm\.sh\/react(?!@)(?=["'\s\/]|$)/g,
    'https://esm.sh/react@18'
  );
  result = result.replace(
    /https:\/\/esm\.sh\/react-dom(?!@)(?=["'\s\/]|$)/g,
    'https://esm.sh/react-dom@18'
  );

  // Handle static imports with bare specifiers ONLY
  // Use a capture group approach: match "from" followed by quote, then the package name
  // Critical: The regex must ensure we're matching a BARE specifier (no slashes before the package name)

  // react core - match exactly 'from "react"' or "from 'react'" (bare specifier only)
  // The negative lookbehind (?<!/) ensures we don't match URLs like "esm.sh/react"
  // But since lookbehinds can be tricky, we use word boundary and quote matching instead
  result = result.replace(
    /from\s+(["'])react\1(?=[\s;,)]|$)/g,
    'from $1https://esm.sh/react@18$1'
  );

  // react subpaths like react/jsx-runtime, react/jsx-dev-runtime (bare specifier only)
  // Must match "react/" at the START of the specifier
  result = result.replace(
    /from\s+(["'])react\/([\w-]+)\1/g,
    'from $1https://esm.sh/react@18/$2$1'
  );

  // react-dom core (bare specifier only)
  result = result.replace(
    /from\s+(["'])react-dom\1(?=[\s;,)]|$)/g,
    'from $1https://esm.sh/react-dom@18$1'
  );

  // react-dom subpaths like react-dom/client (bare specifier only)
  result = result.replace(
    /from\s+(["'])react-dom\/([\w-]+)\1/g,
    'from $1https://esm.sh/react-dom@18/$2$1'
  );

  return result;
}

/**
 * Transform npm package imports to esm.sh CDN URLs
 * This allows Deno/esbuild to fetch packages without npm install
 *
 * Examples:
 *   import { S3Client } from "@aws-sdk/client-s3"
 *   -> import { S3Client } from "https://esm.sh/@aws-sdk/client-s3"
 *
 *   import React from "react"
 *   -> import React from "https://esm.sh/react"
 */
function transformNpmImportsToCdn(code: string): string {
  // Match import statements with npm package names (not relative paths, not URLs)
  // Handles: import x from "pkg", import { x } from "pkg", import * as x from "pkg"
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
    // esm.sh handles scoped packages like @aws-sdk/client-s3 correctly
    return `${prefix}https://esm.sh/${packageName}${suffix}`;
  });
}

/**
 * Quick bundle using in-memory transformation (no esbuild)
 * For simple cases without npm dependencies
 * Keeps ESM format - transformation happens at runtime for server apps
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
    hasExternalImports: detectExternalImports(entryFile.content),
  };
}
