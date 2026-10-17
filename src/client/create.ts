import {
  DEFAULT_TIMER_SECONDS,
  TIMER_CHOICES,
  WORD_COUNTS,
  type CreateRoomResponse,
  type GameSettings,
} from '../shared/protocol.js';
import { saveHostKey, saveName, savedName } from './storage.js';

const DEFAULT_WORD_COUNT = 20;
const BASE_POINTS = 100;
const MAX_SPEED_BONUS = 100;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const form = $<HTMLFormElement>('create-form');
const nameInput = $<HTMLInputElement>('name');
const speedScoring = $<HTMLInputElement>('speed-scoring');
const colorFeedback = $<HTMLInputElement>('color-feedback');
const pronounce = $<HTMLInputElement>('pronounce');
const timerEnabled = $<HTMLInputElement>('timer-enabled');
const timerRow = $('timer-row');
const summary = $('summary');
const errorBox = $('error');

nameInput.value = savedName() ?? '';

const radios = (name: string, values: readonly number[], selected: number) =>
  values
    .map((n) => `<label><input type="radio" name="${name}" value="${n}"${n === selected ? ' checked' : ''}>${n}</label>`)
    .join('');

$('word-counts').innerHTML = radios('wordCount', WORD_COUNTS, DEFAULT_WORD_COUNT);
$('timer-choices').innerHTML = radios('timerSeconds', TIMER_CHOICES, DEFAULT_TIMER_SECONDS);

const checkedValue = (name: string) =>
  Number(form.querySelector<HTMLInputElement>(`input[name="${name}"]:checked`)?.value);

function readSettings(): GameSettings {
  return {
    wordCount: checkedValue('wordCount') as GameSettings['wordCount'],
    speedScoring: speedScoring.checked,
    colorFeedback: colorFeedback.checked,
    timerEnabled: timerEnabled.checked,
    timerSeconds: checkedValue('timerSeconds'),
    pronounce: pronounce.checked,
  };
}

/** e.g. "Correct answer: 100 pts + up to 100 for speed · 5 s per word · Max 4,000 pts" */
function renderSummary(): void {
  const s = readSettings();
  timerRow.hidden = !s.timerEnabled;
  const perAnswer = s.speedScoring ? `${BASE_POINTS} pts + up to ${MAX_SPEED_BONUS} for speed` : `${BASE_POINTS} pts`;
  const max = s.wordCount * (BASE_POINTS + (s.speedScoring ? MAX_SPEED_BONUS : 0));
  summary.textContent = [
    `Correct answer: ${perAnswer}`,
    s.timerEnabled ? `${s.timerSeconds} s per word` : 'No time limit',
    `Max ${max.toLocaleString('en-US')} pts`,
  ].join(' · ');
}

form.addEventListener('change', renderSummary);
renderSummary();

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorBox.hidden = true;
  const settings = readSettings();

  const submit = form.querySelector<HTMLButtonElement>('button[type="submit"]')!;
  submit.disabled = true;
  try {
    const res = await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? 'Could not create the game.');
    const { roomId, hostKey } = (await res.json()) as CreateRoomResponse;
    saveName(nameInput.value.trim());
    saveHostKey(roomId, hostKey);
    location.href = `/r/${roomId}`;
  } catch (err) {
    errorBox.textContent = err instanceof Error ? err.message : String(err);
    errorBox.hidden = false;
    submit.disabled = false;
  }
});
