export function parseHeaders(text: string): { pattern: string; headers: [string, string][] }[];
export function headersFor(rules: { pattern: string; headers: [string, string][] }[], path: string): Map<string, string>;
