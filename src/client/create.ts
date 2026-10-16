import { WORD_COUNTS, type CreateRoomResponse, type GameSettings } from '../shared/protocol.js';
import { saveHostKey, saveName, savedName } from './storage.js';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const form = $<HTMLFormElement>('create-form');
const nameInput = $<HTMLInputElement>('name');
const speedScoring = $<HTMLInputElement>('speed-scoring');
const colorFeedback = $<HTMLInputElement>('color-feedback');
const timerEnabled = $<HTMLInputElement>('timer-enabled');
const timerSeconds = $<HTMLInputElement>('timer-seconds');
const timerRow = $('timer-row');
const errorBox = $('error');

nameInput.value = savedName() ?? '';

$('word-counts').innerHTML = WORD_COUNTS.map(
  (n) => `<label><input type="radio" name="wordCount" value="${n}"${n === 20 ? ' checked' : ''}>${n}</label>`,
).join('');

timerEnabled.addEventListener('change', () => {
  timerRow.hidden = !timerEnabled.checked;
});

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  errorBox.hidden = true;

  const checked = form.querySelector<HTMLInputElement>('input[name="wordCount"]:checked');
  const settings: GameSettings = {
    wordCount: Number(checked?.value) as GameSettings['wordCount'],
    speedScoring: speedScoring.checked,
    colorFeedback: colorFeedback.checked,
    timerEnabled: timerEnabled.checked,
    timerSeconds: Number(timerSeconds.value),
  };

  const submit = form.querySelector('button')!;
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
