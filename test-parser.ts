// Test script for the TypeScript parser
// Run with: deno run --allow-read test-parser.ts

import { parseTypeScript, toSkillsParsed } from './api/services/parser.ts';
import { generateSkillsMd, validateAndParseSkillsMd, generateEmbeddingText } from './api/services/docgen.ts';

// Sample app code to test parsing
const sampleCode = `
/**
 * A sample weather app demonstrating the parser
 * @description Provides weather data and forecasting tools
 */

/**
 * Fetch current weather for a location
 * @param location - City name or coordinates (e.g., "San Francisco" or "37.7749,-122.4194")
 * @param units - Temperature units
 * @returns Current weather data
 * @example
 * const weather = await fetchWeather("San Francisco", "metric");
 * console.log(weather.temperature);
 */
export async function fetchWeather(
  location: string,
  units: 'metric' | 'imperial' = 'metric'
): Promise<WeatherData> {
  const response = await fetch(\`https://api.weather.com/\${location}\`);
  return response.json();
}

/**
 * Get a 7-day weather forecast
 * @param location - City name
 * @param days - Number of days (1-14)
 * @returns Array of daily forecasts
 */
export async function getForecast(location: string, days?: number): Promise<Forecast[]> {
  const data = await ultralight.load('forecasts');
  return data as Forecast[];
}

/**
 * Store user's favorite locations
 */
export const saveFavorite = async (name: string, coords: { lat: number; lng: number }) => {
  await ultralight.store(\`favorites/\${name}\`, coords);
};

// Helper function (not exported, should not appear in docs)
function formatTemperature(temp: number, units: string): string {
  return units === 'metric' ? \`\${temp}°C\` : \`\${temp}°F\`;
}

// Type definitions
export interface WeatherData {
  /** Current temperature */
  temperature: number;
  /** Weather conditions description */
  conditions: string;
  /** Humidity percentage (0-100) */
  humidity: number;
  /** Wind speed */
  windSpeed: number;
}

export interface Forecast {
  date: string;
  high: number;
  low: number;
  conditions: string;
}
`;

console.log('=== Testing TypeScript Parser ===\n');

// Test 1: Parse the code
console.log('1. Parsing sample code...');
const parseResult = parseTypeScript(sampleCode, 'weather-app.ts');

console.log('\nParse Result:');
console.log(`  Functions found: ${parseResult.functions.length}`);
console.log(`  Types found: ${Object.keys(parseResult.types).length}`);
console.log(`  Permissions inferred: ${parseResult.permissions.join(', ') || 'none'}`);
console.log(`  Parse errors: ${parseResult.parseErrors.length}`);
console.log(`  Parse warnings: ${parseResult.parseWarnings.length}`);

if (parseResult.parseErrors.length > 0) {
  console.log('\n  Errors:');
  parseResult.parseErrors.forEach(e => console.log(`    - ${e}`));
}

if (parseResult.parseWarnings.length > 0) {
  console.log('\n  Warnings:');
  parseResult.parseWarnings.forEach(w => console.log(`    - ${w}`));
}

// Test 2: Show parsed functions
console.log('\n2. Parsed Functions:');
for (const fn of parseResult.functions) {
  console.log(`\n  ${fn.isAsync ? 'async ' : ''}${fn.name}(${fn.parameters.map(p => p.name).join(', ')})`);
  console.log(`    Description: ${fn.description || '(none)'}`);
  console.log(`    Parameters: ${fn.parameters.length}`);
  fn.parameters.forEach(p => {
    console.log(`      - ${p.name}: ${p.type} ${p.required ? '(required)' : '(optional)'}`);
    if (p.description) console.log(`        "${p.description}"`);
  });
  console.log(`    Returns: ${fn.returns.type}`);
  if (fn.examples.length > 0) {
    console.log(`    Examples: ${fn.examples.length}`);
  }
}

// Test 3: Show parsed types
console.log('\n3. Parsed Types:');
for (const [name, schema] of Object.entries(parseResult.types)) {
  console.log(`\n  ${name}:`);
  console.log(`    ${JSON.stringify(schema, null, 2).split('\n').join('\n    ')}`);
}

// Test 4: Convert to ParsedSkills
console.log('\n4. Converting to ParsedSkills format...');
const skillsParsed = toSkillsParsed(parseResult);
console.log(`  Functions: ${skillsParsed.functions.length}`);
console.log(`  Permissions: ${skillsParsed.permissions.map(p => p.permission).join(', ')}`);

// Test 5: Generate Skills.md
console.log('\n5. Generating Skills.md...');
const skillsMd = generateSkillsMd('Weather App', parseResult);
console.log('\n--- Generated Skills.md ---');
console.log(skillsMd);
console.log('--- End Skills.md ---\n');

// Test 6: Validate round-trip
console.log('6. Validating Skills.md round-trip...');
const validation = validateAndParseSkillsMd(skillsMd);
console.log(`  Valid: ${validation.valid}`);
console.log(`  Functions recovered: ${validation.skills_parsed?.functions.length || 0}`);
if (validation.errors.length > 0) {
  console.log(`  Errors:`);
  validation.errors.forEach(e => console.log(`    - ${e.message}`));
}
if (validation.warnings.length > 0) {
  console.log(`  Warnings:`);
  validation.warnings.forEach(w => console.log(`    - ${w}`));
}

// Test 7: Generate embedding text
console.log('\n7. Generating embedding text...');
const embeddingText = generateEmbeddingText('Weather App', 'Weather data and forecasting tools', skillsParsed);
console.log('\n--- Embedding Text ---');
console.log(embeddingText);
console.log('--- End Embedding Text ---\n');

console.log('=== All Tests Complete ===');
