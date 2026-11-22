/** Extract cross-references from a commit/PR/issue body. Duplicates collapse. */
export function extractReferences(text: string): Set<number> {
  const numbers = new Set<number>();
  const patterns = [/(?:^|[^\w&])#(\d{1,7})\b/g, /\/issues\/(\d{1,7})\b/g, /\/pull\/(\d{1,7})\b/g];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = Number(match[1]);
      if (Number.isInteger(value) && value > 0) numbers.add(value);
    }
  }
  return numbers;
}

/** Extract file paths from free text. Duplicates collapse. */
export function extractFilePaths(text: string): string[] {
  const matches = text.match(/[\w@./-]+\.(?:ts|tsx|js|jsx|mjs|cjs|py|go|rb|java|kt|rs|c|cc|cpp|h|cs|php|swift|scala|sql|yml|yaml|json|toml|md|tf)\b/g) ?? [];
  return [...new Set(matches)].filter((path) => path.length < 300);
}
