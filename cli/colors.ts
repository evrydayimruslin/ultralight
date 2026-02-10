/**
 * Terminal Colors
 *
 * Simple ANSI color codes for terminal output
 */

// Check if terminal supports colors
let isColorSupported = false;
try {
  isColorSupported = Deno.stdout.isTerminal();
} catch {
  // Fallback for older Deno versions
  try {
    // @ts-ignore - rid may not exist in newer versions
    isColorSupported = Deno.isatty(Deno.stdout.rid);
  } catch {
    isColorSupported = false;
  }
}

function color(code: number, text: string): string {
  if (!isColorSupported) return text;
  return `\x1b[${code}m${text}\x1b[0m`;
}

export const colors = {
  // Formatting
  bold: (text: string) => color(1, text),
  dim: (text: string) => color(2, text),
  italic: (text: string) => color(3, text),
  underline: (text: string) => color(4, text),

  // Colors
  red: (text: string) => color(31, text),
  green: (text: string) => color(32, text),
  yellow: (text: string) => color(33, text),
  blue: (text: string) => color(34, text),
  magenta: (text: string) => color(35, text),
  cyan: (text: string) => color(36, text),
  white: (text: string) => color(37, text),
  gray: (text: string) => color(90, text),

  // Bright colors
  brightRed: (text: string) => color(91, text),
  brightGreen: (text: string) => color(92, text),
  brightYellow: (text: string) => color(93, text),
  brightBlue: (text: string) => color(94, text),
  brightMagenta: (text: string) => color(95, text),
  brightCyan: (text: string) => color(96, text),
  brightWhite: (text: string) => color(97, text),
};
