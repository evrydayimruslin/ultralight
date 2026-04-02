// Parse file operation markers from model text responses.
// Supports two formats:
//   1. Explicit markers:  <!-- file:write path="src/foo.ts" --> ... <!-- /file:write -->
//   2. Fenced code blocks with file-path info strings: ```src/foo.ts ... ```

export interface FileOperation {
  type: 'write';
  path: string;
  content: string;
}

/**
 * Extract file write operations from model-generated text.
 * Returns an array of operations to execute locally via Rust tools.
 */
export function parseFileOperations(text: string): FileOperation[] {
  const ops: FileOperation[] = [];
  const seen = new Set<string>();

  // ── Format 1: Explicit markers ──
  // <!-- file:write path="src/example.ts" -->
  // ```ts
  // content
  // ```
  // <!-- /file:write -->
  const markerRegex = /<!--\s*file:write\s+path="([^"]+)"\s*-->\s*```[^\n]*\n([\s\S]*?)```\s*<!--\s*\/file:write\s*-->/g;
  let match;
  while ((match = markerRegex.exec(text)) !== null) {
    const path = match[1].trim();
    const content = match[2];
    if (path && content && !seen.has(path)) {
      seen.add(path);
      ops.push({ type: 'write', path, content });
    }
  }

  // If explicit markers found, prefer those over heuristic parsing
  if (ops.length > 0) return ops;

  // ── Format 2: Fenced code blocks with file-path info strings ──
  // ```src/components/Foo.tsx
  // content
  // ```
  const fenceRegex = /```([\w./\\-]+\.\w{1,10})\n([\s\S]*?)```/g;
  while ((match = fenceRegex.exec(text)) !== null) {
    const infoString = match[1].trim();
    const content = match[2];

    // Must look like a file path: contains / or \ and has a file extension
    if (infoString.includes('/') && content && !seen.has(infoString)) {
      seen.add(infoString);
      ops.push({ type: 'write', path: infoString, content });
    }
  }

  return ops;
}
