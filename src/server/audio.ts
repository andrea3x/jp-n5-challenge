import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Word } from './vocabulary.js';

export const AUDIO_DIR = path.resolve(import.meta.dirname, '..', '..', 'public', 'audio');

/** Stable, ASCII-only file name for a word's pronunciation. */
export function audioFileName(word: Word): string {
  const hash = createHash('sha256').update(`${word.word}|${word.reading}`).digest('hex');
  return `${hash.slice(0, 16)}.mp3`;
}

/** Maps each word to its audio URL, for the words whose file exists. Run once at startup. */
export function buildAudioIndex(vocabulary: Word[], dir = AUDIO_DIR): Map<Word, string> {
  const index = new Map<Word, string>();
  for (const word of vocabulary) {
    const file = audioFileName(word);
    if (existsSync(path.join(dir, file))) index.set(word, `/audio/${file}`);
  }
  return index;
}
