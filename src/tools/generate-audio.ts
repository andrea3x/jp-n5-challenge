// Generates public/audio/*.mp3 for every vocabulary entry using a local VOICEVOX engine.
//
//   podman run --rm -p 50021:50021 docker.io/voicevox/voicevox_engine:cpu-latest
//   npm run audio
//
// Existing files are skipped, so after editing data/n5.json only new words are generated.

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { AUDIO_DIR, audioFileName } from '../server/audio.js';
import { loadVocabulary, type Word } from '../server/vocabulary.js';

// 127.0.0.1 rather than localhost: rootless podman resets IPv6 (::1) connections to published ports.
const ENGINE = process.env.VOICEVOX_URL ?? 'http://127.0.0.1:50021';
const SPEAKER = Number(process.env.VOICEVOX_SPEAKER ?? 2); // 四国めたん (ノーマル)
const SPEED_SCALE = 0.9;
const SILENCE_SECONDS = 0.1;
const MP3_BITRATE = '48k';

interface AudioQuery {
  accent_phrases: { moras: { text: string }[] }[];
  speedScale: number;
  prePhonemeLength: number;
  postPhonemeLength: number;
}

async function audioQuery(text: string): Promise<AudioQuery> {
  const url = `${ENGINE}/audio_query?speaker=${SPEAKER}&text=${encodeURIComponent(text)}`;
  const res = await fetch(url, { method: 'POST' });
  if (!res.ok) throw new Error(`audio_query failed for "${text}": ${res.status} ${await res.text()}`);
  return (await res.json()) as AudioQuery;
}

async function synthesize(query: AudioQuery): Promise<Buffer> {
  const res = await fetch(`${ENGINE}/synthesis?speaker=${SPEAKER}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(query),
  });
  if (!res.ok) throw new Error(`synthesis failed: ${res.status} ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

function toKatakana(text: string): string {
  return text.replace(/[ぁ-ゖ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) + 0x60));
}

/**
 * The engine spells long vowels as they sound (コーヒー → コオヒイ, きょう → キョオ, せんせい → センセエ),
 * so both sides are compared with ー expanded and おう/えい lengthened the same way.
 */
const VOWEL_OF: Record<string, string> = Object.fromEntries(
  (
    [
      ['ア', 'アカガサザタダナハバパマヤャラワァ'],
      ['イ', 'イキギシジチヂニヒビピミリィ'],
      ['ウ', 'ウクグスズツヅヌフブプムユュルゥヴ'],
      ['エ', 'エケゲセゼテデネヘベペメレェ'],
      ['オ', 'オコゴソゾトドノホボポモヨョロヲォ'],
    ] as const
  ).flatMap(([vowel, kana]) => [...kana].map((k) => [k, vowel])),
);

function normalize(katakana: string): string {
  let out = '';
  for (const ch of katakana) {
    const prevVowel = VOWEL_OF[out.at(-1) ?? ''];
    if (ch === 'ー' && prevVowel) out += prevVowel;
    else if (ch === 'ウ' && prevVowel === 'オ') out += 'オ';
    else if (ch === 'イ' && prevVowel === 'エ') out += 'エ';
    else out += ch;
  }
  return out;
}

function spokenKana(query: AudioQuery): string {
  return query.accent_phrases.flatMap((p) => p.moras.map((m) => m.text)).join('');
}

function toMp3(wav: Buffer, outFile: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(
      'ffmpeg',
      ['-loglevel', 'error', '-y', '-i', 'pipe:0', '-ac', '1', '-codec:a', 'libmp3lame', '-b:a', MP3_BITRATE, outFile],
      { stdio: ['pipe', 'inherit', 'inherit'] },
    );
    ffmpeg.on('error', reject);
    ffmpeg.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited with ${code}`))));
    ffmpeg.stdin.end(wav);
  });
}

/**
 * Queries with the written word first, so the engine's dictionary picks the right pitch accent
 * (橋 vs 箸). If the engine reads it differently from our reading (方 → ほう), query the kana instead.
 */
async function queryFor(word: Word): Promise<{ query: AudioQuery; fallback: boolean }> {
  const expected = normalize(toKatakana(word.reading));
  const query = await audioQuery(word.word);
  if (normalize(spokenKana(query)) === expected) return { query, fallback: false };
  return { query: await audioQuery(word.reading), fallback: true };
}

async function main(): Promise<void> {
  const vocabulary = loadVocabulary();
  mkdirSync(AUDIO_DIR, { recursive: true });
  const todo = vocabulary.filter((w) => !existsSync(path.join(AUDIO_DIR, audioFileName(w))));
  console.log(`${vocabulary.length} words, ${todo.length} to generate (speaker ${SPEAKER}).`);

  const misread: string[] = [];
  for (const [i, word] of todo.entries()) {
    const { query, fallback } = await queryFor(word);
    if (fallback) misread.push(`${word.word} (${word.reading})`);
    query.speedScale = SPEED_SCALE;
    query.prePhonemeLength = SILENCE_SECONDS;
    query.postPhonemeLength = SILENCE_SECONDS;
    await toMp3(await synthesize(query), path.join(AUDIO_DIR, audioFileName(word)));
    process.stdout.write(`\r${i + 1}/${todo.length} ${word.word}      `);
  }
  console.log(todo.length ? '\nDone.' : 'Nothing to do.');
  if (misread.length) console.log(`Generated from the reading because the kanji was misread:\n  ${misread.join('\n  ')}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
