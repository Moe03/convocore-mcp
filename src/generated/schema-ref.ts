import { ZOD_SCHEMAS, type ZodSchemaKey } from './zod-schemas.js';

/**
 * A tool parameter schema generated from the main zod schemas (see scripts/sync-zod-schemas.mjs).
 * Returns a fresh copy so tools can add their own top-level description.
 */
export function zodSchema(key: ZodSchemaKey): Record<string, unknown> {
  const schema = ZOD_SCHEMAS[key];
  if (!schema) throw new Error(`Unknown generated schema: ${String(key)}. Run pnpm sync:schemas.`);
  return JSON.parse(JSON.stringify(schema));
}

/**
 * Compact stand-in for a big generated schema: the field names (and nothing else), for tools that accept the same
 * fields as another tool. Keeps the tool list small while the model still knows every valid name.
 */
export function zodFieldSummary(key: ZodSchemaKey, fullSchemaLocation: string): Record<string, unknown> {
  const schema = ZOD_SCHEMAS[key] as { properties?: Record<string, unknown> };
  const names = Object.keys(schema?.properties ?? {});
  return {
    type: 'object',
    description: `Same fields as ${fullSchemaLocation}. Fields: ${names.join(', ')}.`,
  };
}
