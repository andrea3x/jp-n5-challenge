import { readFileSync } from 'node:fs';
import path from 'node:path';

export interface Word {
  word: string;
  reading: string;
  meaning: string;
}

const DEFAULT_FILE = path.resolve(import.meta.dirname, '..', '..', 'data', 'n5.json');

/**
 * Loads and validates the vocabulary file. Meanings must be unique so that a
 * distractor can never be identical to the correct answer.
 */
export function loadVocabulary(file = DEFAULT_FILE): Word[] {
  const raw: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (!Array.isArray(raw)) throw new Error(`${file}: expected a JSON array`);

  const meanings = new Set<string>();
  const words: Word[] = raw.map((entry, i) => {
    const { word, reading, meaning } = (entry ?? {}) as Partial<Word>;
    if (!isNonEmptyString(word) || !isNonEmptyString(reading) || !isNonEmptyString(meaning)) {
      throw new Error(`${file}: entry ${i} must have non-empty "word", "reading" and "meaning"`);
    }
    const key = meaning.toLowerCase();
    if (meanings.has(key)) throw new Error(`${file}: duplicate meaning "${meaning}" at entry ${i}`);
    meanings.add(key);
    return { word, reading, meaning };
  });

  if (words.length < 4) throw new Error(`${file}: at least 4 words are required`);
  return words;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
