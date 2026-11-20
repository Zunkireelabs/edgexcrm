export function generate(): Promise<{ text: string; summary: Record<string, string[]> }>;
export function scan(files: string[]): { icons: Set<string>; used: Record<string, Set<string>>; errors: string[] };
