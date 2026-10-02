/**
 * Express 5 params can be string | string[]; normalize to a single string.
 */
export function routeParam(
  value: string | string[] | undefined
): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

export function routeParamInt(
  value: string | string[] | undefined,
  fallback = NaN
): number {
  const parsed = parseInt(routeParam(value), 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}
