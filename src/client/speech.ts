// Pronounces the question word: plays the pre-generated file, or falls back to the browser's speech synthesis.

import type { QuestionPayload } from '../shared/protocol.js';
import { saveMuted, savedMuted } from './storage.js';

const SYNTH_RATE = 0.9;

let audio: HTMLAudioElement | null = null;
let muted = savedMuted();

export const isMuted = () => muted;

export function setMuted(value: boolean): void {
  muted = value;
  saveMuted(value);
  if (muted) stopSpeech();
}

export function stopSpeech(): void {
  if (audio) {
    audio.pause();
    audio = null;
  }
  if ('speechSynthesis' in window) speechSynthesis.cancel();
}

/** `force` plays even when muted (an explicit click), without changing the saved preference. */
export function speak(q: Pick<QuestionPayload, 'audioUrl' | 'reading'>, { force = false } = {}): void {
  stopSpeech();
  if (muted && !force) return;
  if (!q.audioUrl) {
    synthesize(q.reading);
    return;
  }

  const el = new Audio(q.audioUrl);
  audio = el;
  let failed = false;
  // A broken file can report both an `error` event and a rejected play(): fall back only once,
  // and only if this is still the word being pronounced.
  const fail = (err: unknown) => {
    if (failed || audio !== el) return;
    failed = true;
    console.error('Audio playback failed', q.audioUrl, err);
    synthesize(q.reading);
  };

  el.addEventListener('error', () => fail(`MediaError ${el.error?.code ?? '?'}: ${el.error?.message || 'unknown'}`));
  el.play().catch((err: unknown) => {
    if (err instanceof DOMException && err.name === 'NotAllowedError') {
      // Autoplay blocked until the user interacts with the page; speech synthesis would be blocked too.
      console.warn('Autoplay blocked by the browser; use the replay button.');
      return;
    }
    if (err instanceof DOMException && err.name === 'AbortError') return; // interrupted by stopSpeech()
    fail(err);
  });
}

/** Reads the kana reading (not the kanji) so the browser cannot pick a wrong reading. */
function synthesize(text: string): void {
  if (!('speechSynthesis' in window)) {
    console.warn('Speech synthesis is not supported by this browser.');
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'ja-JP';
  utterance.rate = SYNTH_RATE;
  const voice = speechSynthesis.getVoices().find((v) => v.lang.toLowerCase().startsWith('ja'));
  if (voice) utterance.voice = voice;
  speechSynthesis.speak(utterance);
}
