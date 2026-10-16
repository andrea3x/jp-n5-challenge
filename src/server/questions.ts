import type { Word } from './vocabulary.js';

export interface Question {
  word: string;
  reading: string;
  choices: string[];
  answer: number;
}

const CHOICES_PER_QUESTION = 4;

export function buildQuestions(vocabulary: Word[], count: number): Question[] {
  return sample(vocabulary, Math.min(count, vocabulary.length)).map((target) => {
    const distractors = sample(
      vocabulary.filter((w) => w !== target),
      CHOICES_PER_QUESTION - 1,
    ).map((w) => w.meaning);
    const choices = shuffle([target.meaning, ...distractors]);
    return {
      word: target.word,
      reading: target.reading,
      choices,
      answer: choices.indexOf(target.meaning),
    };
  });
}

/** Returns `n` distinct random items (partial Fisher–Yates on a copy). */
function sample<T>(items: readonly T[], n: number): T[] {
  const copy = [...items];
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(Math.random() * (copy.length - i));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy.slice(0, n);
}

function shuffle<T>(items: T[]): T[] {
  return sample(items, items.length);
}
