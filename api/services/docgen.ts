// Document Generation Service
// Generates Skills.md from ParsedSkills and validates markdown edits

import type { ParsedSkills, SkillFunction, PermissionDeclaration } from '../../shared/types/index.ts';
import type { ParseResult, ParsedFunction, ParsedParameter, JsonSchema } from './parser.ts';

// ============================================
// TYPES
// ============================================

export interface GenerationResult {
  success: boolean;
  partial: boolean;
  skills_md: string | null;
  skills_parsed: ParsedSkills | null;
  embedding_text: string | null;
  errors: GenerationError[];
  warnings: string[];
}

export interface GenerationError {
  phase: 'parse' | 'generate_skills' | 'validate' | 'embed';
  message: string;
  line?: number;
  suggestion?: string;
}

export interface ValidationResult {
  valid: boolean;
  skills_parsed: ParsedSkills | null;
  errors: ValidationError[];
  warnings: string[];
}

export interface ValidationError {
  line?: number;
  message: string;
  suggestion?: string;
}

// ============================================
// SKILLS.MD GENERATION
// ============================================

/**
 * Generate Skills.md markdown from ParseResult
 */
export function generateSkillsMd(
  appName: string,
  parseResult: ParseResult,
  options: { includeExamples?: boolean; includePermissions?: boolean } = {}
): string {
  const { includeExamples = true, includePermissions = true } = options;
  const lines: string[] = [];

  // Header
  lines.push(`# ${appName} Skills`);
  lines.push('');

  // File description if available
  if (parseResult.description) {
    lines.push(`> ${parseResult.description}`);
    lines.push('');
  }

  // Auto-generated notice
  lines.push('<!-- Auto-generated documentation. Edit with caution. -->');
  lines.push('');

  // Permissions summary if any
  if (includePermissions && parseResult.permissions.length > 0) {
    lines.push('## Required Permissions');
    lines.push('');
    for (const perm of parseResult.permissions) {
      lines.push(`- \`${perm}\``);
    }
    lines.push('');
  }

  // Functions section
  if (parseResult.functions.length > 0) {
    lines.push('## Functions');
    lines.push('');

    for (const fn of parseResult.functions) {
      lines.push(generateFunctionDoc(fn, { includeExamples, includePermissions }));
      lines.push('');
    }
  } else {
    lines.push('## Functions');
    lines.push('');
    lines.push('*No exported functions found.*');
    lines.push('');
  }

  // Type definitions section (if any complex types)
  if (Object.keys(parseResult.types).length > 0) {
    lines.push('## Type Definitions');
    lines.push('');

    for (const [typeName, schema] of Object.entries(parseResult.types)) {
      lines.push(`### \`${typeName}\``);
      lines.push('');
      lines.push('```typescript');
      lines.push(schemaToTypeDefinition(typeName, schema));
      lines.push('```');
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Generate documentation for a single function
 */
function generateFunctionDoc(
  fn: ParsedFunction,
  options: { includeExamples?: boolean; includePermissions?: boolean }
): string {
  const lines: string[] = [];

  // Function signature
  const params = fn.parameters.map(p => {
    const optional = !p.required ? '?' : '';
    return `${p.name}${optional}: ${p.type}`;
  }).join(', ');

  const asyncPrefix = fn.isAsync ? 'async ' : '';
  lines.push(`### \`${asyncPrefix}${fn.name}(${params}): ${fn.returns.type}\``);
  lines.push('');

  // Description
  if (fn.description) {
    lines.push(fn.description);
    lines.push('');
  }

  // Parameters table
  if (fn.parameters.length > 0) {
    lines.push('**Parameters:**');
    lines.push('');
    lines.push('| Name | Type | Required | Description |');
    lines.push('|------|------|----------|-------------|');

    for (const param of fn.parameters) {
      const req = param.required ? 'Yes' : 'No';
      const desc = param.description || '-';
      const defaultStr = param.default !== undefined ? ` (default: \`${JSON.stringify(param.default)}\`)` : '';
      lines.push(`| \`${param.name}\` | \`${escapeTableCell(param.type)}\` | ${req} | ${escapeTableCell(desc)}${defaultStr} |`);
    }
    lines.push('');
  }

  // Returns
  if (fn.returns.type !== 'void' && fn.returns.type !== 'Promise<void>') {
    lines.push(`**Returns:** \`${fn.returns.type}\`${fn.returns.description ? ` - ${fn.returns.description}` : ''}`);
    lines.push('');
  }

  // Examples
  if (options.includeExamples && fn.examples.length > 0) {
    lines.push('**Example:**');
    lines.push('');
    for (const example of fn.examples) {
      // Check if example is already wrapped in code fence
      if (example.includes('```')) {
        lines.push(example);
      } else {
        lines.push('```typescript');
        lines.push(example);
        lines.push('```');
      }
      lines.push('');
    }
  }

  // Permissions
  if (options.includePermissions && fn.permissions.length > 0) {
    lines.push('**Permissions Required:**');
    lines.push('');
    for (const perm of fn.permissions) {
      lines.push(`- \`${perm}\``);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Escape special characters for markdown table cells
 */
function escapeTableCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/**
 * Convert JSON Schema to TypeScript type definition string
 */
function schemaToTypeDefinition(name: string, schema: JsonSchema): string {
  if (schema.type === 'object' && schema.properties) {
    const props = Object.entries(schema.properties).map(([propName, propSchema]) => {
      const optional = !(schema.required?.includes(propName));
      const typeStr = schemaToTypeString(propSchema as JsonSchema);
      const desc = (propSchema as JsonSchema).description;
      const comment = desc ? `  // ${desc}\n` : '';
      return `${comment}  ${propName}${optional ? '?' : ''}: ${typeStr};`;
    });
    return `interface ${name} {\n${props.join('\n')}\n}`;
  }

  return `type ${name} = ${schemaToTypeString(schema)};`;
}

/**
 * Convert JSON Schema to TypeScript type string
 */
function schemaToTypeString(schema: JsonSchema): string {
  if (!schema) return 'unknown';

  if (schema.$ref) {
    return schema.$ref.replace('#/definitions/', '');
  }

  if (schema.oneOf) {
    return (schema.oneOf as JsonSchema[]).map(s => schemaToTypeString(s)).join(' | ');
  }

  if (schema.allOf) {
    return (schema.allOf as JsonSchema[]).map(s => schemaToTypeString(s)).join(' & ');
  }

  if (schema.enum) {
    return schema.enum.map(v => JSON.stringify(v)).join(' | ');
  }

  if (schema.type === 'array') {
    if (schema.items) {
      if (Array.isArray(schema.items)) {
        return `[${schema.items.map(i => schemaToTypeString(i)).join(', ')}]`;
      }
      return `${schemaToTypeString(schema.items)}[]`;
    }
    return 'unknown[]';
  }

  if (schema.type === 'object') {
    if (schema.properties) {
      const props = Object.entries(schema.properties)
        .map(([k, v]) => {
          const optional = !(schema.required?.includes(k));
          return `${k}${optional ? '?' : ''}: ${schemaToTypeString(v as JsonSchema)}`;
        })
        .join('; ');
      return `{ ${props} }`;
    }
    if (schema.additionalProperties) {
      return `Record<string, ${schemaToTypeString(schema.additionalProperties as JsonSchema)}>`;
    }
    return 'object';
  }

  if (schema.type === 'string') return 'string';
  if (schema.type === 'number') return 'number';
  if (schema.type === 'boolean') return 'boolean';
  if (schema.type === 'null') return 'null';

  return 'unknown';
}

// ============================================
// SKILLS.MD VALIDATION & PARSING
// ============================================

/**
 * Validate and parse Skills.md markdown back to ParsedSkills
 * Used when user manually edits the markdown
 */
export function validateAndParseSkillsMd(markdown: string): ValidationResult {
  const errors: ValidationError[] = [];
  const warnings: string[] = [];
  const functions: SkillFunction[] = [];
  const permissions: PermissionDeclaration[] = [];
  let description: string | undefined;

  try {
    const lines = markdown.split('\n');
    let lineNum = 0;

    // Extract description from blockquote near top
    for (let i = 0; i < Math.min(10, lines.length); i++) {
      const line = lines[i];
      if (line.startsWith('> ')) {
        description = line.slice(2).trim();
        break;
      }
    }

    // Extract permissions from "Required Permissions" section
    let inPermissionsSection = false;
    for (const line of lines) {
      lineNum++;
      if (line.match(/^##\s+Required Permissions/i)) {
        inPermissionsSection = true;
        continue;
      }
      if (line.startsWith('## ') && inPermissionsSection) {
        inPermissionsSection = false;
        continue;
      }
      if (inPermissionsSection && line.startsWith('- `')) {
        const permMatch = line.match(/^-\s+`([^`]+)`/);
        if (permMatch) {
          permissions.push({ permission: permMatch[1], required: true });
        }
      }
    }

    // Parse function definitions
    // Match: ### `functionName(params): ReturnType` or ### `async functionName(...)`
    const functionRegex = /^###\s+`(async\s+)?(\w+)\(([^)]*)\)(?::\s*(.+?))?`\s*$/;

    lineNum = 0;
    let currentFunction: Partial<SkillFunction> | null = null;
    let currentSection: 'description' | 'parameters' | 'returns' | 'example' | 'permissions' | null = null;
    let parameterLines: string[] = [];
    let exampleLines: string[] = [];
    let inCodeBlock = false;

    for (const line of lines) {
      lineNum++;

      // Track code blocks
      if (line.startsWith('```')) {
        inCodeBlock = !inCodeBlock;
        if (currentSection === 'example') {
          exampleLines.push(line);
        }
        continue;
      }

      if (inCodeBlock) {
        if (currentSection === 'example') {
          exampleLines.push(line);
        }
        continue;
      }

      // Check for function header
      const fnMatch = line.match(functionRegex);
      if (fnMatch) {
        // Save previous function
        if (currentFunction && currentFunction.name) {
          functions.push(finalizeParsedFunction(currentFunction, parameterLines, exampleLines, warnings));
        }

        // Start new function
        const [, asyncPrefix, name, paramsStr, returnType] = fnMatch;
        currentFunction = {
          name,
          description: '',
          parameters: {},
          returns: returnType ? parseReturnType(returnType) : { type: 'null' },
          examples: [],
        };
        currentSection = 'description';
        parameterLines = [];
        exampleLines = [];
        continue;
      }

      // Section headers within a function
      if (line.startsWith('**Parameters:**')) {
        currentSection = 'parameters';
        continue;
      }
      if (line.startsWith('**Returns:**')) {
        currentSection = 'returns';
        // Parse inline return description
        if (currentFunction) {
          const returnMatch = line.match(/\*\*Returns:\*\*\s*`([^`]+)`(?:\s*-\s*(.+))?/);
          if (returnMatch) {
            currentFunction.returns = parseReturnType(returnMatch[1]);
          }
        }
        continue;
      }
      if (line.startsWith('**Example:**')) {
        currentSection = 'example';
        continue;
      }
      if (line.startsWith('**Permissions Required:**')) {
        currentSection = 'permissions';
        continue;
      }

      // Skip other section headers
      if (line.startsWith('## ')) {
        currentFunction = null;
        currentSection = null;
        continue;
      }

      // Collect content based on current section
      if (currentFunction && currentSection) {
        switch (currentSection) {
          case 'description':
            if (line.trim() && !line.startsWith('|') && !line.startsWith('**')) {
              currentFunction.description = ((currentFunction.description || '') + ' ' + line).trim();
            }
            break;
          case 'parameters':
            if (line.startsWith('|') && !line.includes('---')) {
              parameterLines.push(line);
            }
            break;
          case 'example':
            exampleLines.push(line);
            break;
        }
      }
    }

    // Save last function
    if (currentFunction && currentFunction.name) {
      functions.push(finalizeParsedFunction(currentFunction, parameterLines, exampleLines, warnings));
    }

    // Validation checks
    if (functions.length === 0) {
      warnings.push('No functions found in Skills.md. Make sure function headers use the format: ### `functionName(params): ReturnType`');
    }

    for (const fn of functions) {
      if (!fn.description) {
        warnings.push(`Function "${fn.name}" has no description.`);
      }
    }

    return {
      valid: errors.length === 0,
      skills_parsed: {
        functions,
        permissions,
        description,
      },
      errors,
      warnings,
    };

  } catch (err) {
    errors.push({
      message: `Failed to parse Skills.md: ${err instanceof Error ? err.message : String(err)}`,
      suggestion: 'Check the markdown syntax and ensure function headers are formatted correctly.',
    });
    return {
      valid: false,
      skills_parsed: null,
      errors,
      warnings,
    };
  }
}

/**
 * Parse parameter table lines into parameters object
 */
function parseParameterTable(lines: string[]): Record<string, unknown> {
  const params: Record<string, unknown> = {};

  for (const line of lines) {
    // Skip header row
    if (line.includes('Name') && line.includes('Type')) continue;

    // Parse: | `name` | `type` | Yes/No | description |
    const match = line.match(/\|\s*`(\w+)`\s*\|\s*`([^`]+)`\s*\|\s*(Yes|No)\s*\|\s*([^|]*)\|?/);
    if (match) {
      const [, name, type, required, desc] = match;
      params[name] = {
        type: typeStringToSchema(type),
        description: desc.trim().replace(/\s*\(default:.*\)/, ''),
      };
    }
  }

  return params;
}

/**
 * Convert a type string to JSON Schema
 */
function typeStringToSchema(typeStr: string): JsonSchema {
  const type = typeStr.trim();

  if (type === 'string') return { type: 'string' };
  if (type === 'number') return { type: 'number' };
  if (type === 'boolean') return { type: 'boolean' };
  if (type === 'null' || type === 'void') return { type: 'null' };

  if (type.endsWith('[]')) {
    const itemType = type.slice(0, -2);
    return { type: 'array', items: typeStringToSchema(itemType) };
  }

  if (type.startsWith('Promise<') && type.endsWith('>')) {
    return typeStringToSchema(type.slice(8, -1));
  }

  // Complex type reference
  return { $ref: `#/definitions/${type}` };
}

/**
 * Parse return type string to schema
 */
function parseReturnType(typeStr: string): unknown {
  return typeStringToSchema(typeStr);
}

/**
 * Finalize a parsed function with parameter and example data
 */
function finalizeParsedFunction(
  fn: Partial<SkillFunction>,
  parameterLines: string[],
  exampleLines: string[],
  warnings: string[]
): SkillFunction {
  // Parse parameters
  const params = parseParameterTable(parameterLines);

  // Parse examples - join non-empty lines
  const exampleText = exampleLines
    .filter(l => l.trim())
    .join('\n')
    .trim();

  return {
    name: fn.name || 'unknown',
    description: fn.description || '',
    parameters: params,
    returns: fn.returns || { type: 'null' },
    examples: exampleText ? [exampleText] : [],
  };
}

// ============================================
// EMBEDDING TEXT GENERATION
// ============================================

/**
 * Generate text optimized for embedding/semantic search
 */
export function generateEmbeddingText(
  appName: string,
  appDescription: string | null,
  skills: ParsedSkills
): string {
  const parts: string[] = [];

  // App identity
  parts.push(appName);
  if (appDescription) {
    parts.push(appDescription);
  }
  if (skills.description) {
    parts.push(skills.description);
  }

  parts.push('');
  parts.push('Functions:');

  // Function summaries
  for (const fn of skills.functions) {
    const paramNames = Object.keys(fn.parameters as Record<string, unknown>);
    const paramStr = paramNames.length > 0 ? `(${paramNames.join(', ')})` : '()';
    parts.push(`- ${fn.name}${paramStr}: ${fn.description}`);
  }

  // Permissions as capabilities
  if (skills.permissions.length > 0) {
    parts.push('');
    parts.push('Capabilities:');
    for (const perm of skills.permissions) {
      // Convert permission to readable capability
      const capability = permissionToCapability(perm.permission);
      if (capability) {
        parts.push(`- ${capability}`);
      }
    }
  }

  return parts.join('\n');
}

/**
 * Convert permission string to human-readable capability
 */
function permissionToCapability(permission: string): string | null {
  const map: Record<string, string> = {
    'storage:read': 'can read stored data',
    'storage:write': 'can write and store data',
    'storage:delete': 'can delete stored data',
    'memory:read': 'can access user memory',
    'memory:write': 'can save to user memory',
    'ai:call': 'can call AI models',
    'cron:read': 'can read scheduled jobs',
    'cron:write': 'can create scheduled jobs',
    'net:fetch': 'can make HTTP requests',
  };
  return map[permission] || null;
}

// ============================================
// AI ENHANCEMENT (placeholder)
// ============================================

/**
 * Enhance parsed skills with AI-generated descriptions
 * This is a placeholder - actual implementation will use the AI service
 */
export async function enhanceWithAI(
  skills: ParsedSkills,
  code: string,
  aiService: (prompt: string) => Promise<string>
): Promise<ParsedSkills> {
  // Clone skills to avoid mutation
  const enhanced: ParsedSkills = JSON.parse(JSON.stringify(skills));

  // Find functions missing descriptions
  const needsDescription = enhanced.functions.filter(fn => !fn.description || fn.description.length < 10);

  if (needsDescription.length === 0) {
    return enhanced;
  }

  // Build prompt for AI
  const prompt = `Given this TypeScript code, provide brief descriptions for these functions:

${needsDescription.map(fn => `- ${fn.name}`).join('\n')}

Code context:
\`\`\`typescript
${code.slice(0, 3000)}${code.length > 3000 ? '\n// ... truncated' : ''}
\`\`\`

Respond with JSON array of {name, description} objects. Keep descriptions under 100 characters.`;

  try {
    const response = await aiService(prompt);

    // Parse AI response
    const match = response.match(/\[[\s\S]*\]/);
    if (match) {
      const descriptions = JSON.parse(match[0]) as Array<{ name: string; description: string }>;

      for (const { name, description } of descriptions) {
        const fn = enhanced.functions.find(f => f.name === name);
        if (fn && description) {
          fn.description = description;
        }
      }
    }
  } catch (err) {
    console.error('AI enhancement failed:', err);
    // Continue with un-enhanced skills
  }

  return enhanced;
}
