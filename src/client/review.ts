// Answer review shown under the podium. Renders one player's answers against the shared questions,
// so showing another player (or a picker over all of them) reuses renderReview as is.

import type { GameReview, ReviewAnswer, ReviewQuestion } from '../shared/protocol.js';
import { $, esc } from './dom.js';
import { speak } from './speech.js';

const section = $('review');
const list = $('review-list');
const empty = $('review-empty');
const onlyMistakes = $<HTMLInputElement>('only-mistakes');

let shown: GameReview | null = null;

export interface ReviewOptions {
  /** Whether the reviewed player is the viewer ("Your answers") or someone else. */
  isViewer: boolean;
  showAudio: boolean;
}

export function hideReview(): void {
  shown = null;
  section.hidden = true;
}

export function renderReview(review: GameReview, playerId: string, { isViewer, showAudio }: ReviewOptions): void {
  const player = review.players.find((p) => p.playerId === playerId);
  if (!player) {
    hideReview();
    return;
  }
  shown = review;

  const answers = new Map(player.answers.map((a) => [a.index, a]));
  const correct = player.answers.filter((a) => a.correct).length;
  $('review-title').textContent =
    `${isViewer ? 'Your answers' : `${player.name}'s answers`} — ${correct}/${review.questions.length} correct`;

  list.innerHTML = review.questions.map((q) => row(q, answers.get(q.index), isViewer, showAudio)).join('');
  section.hidden = false;
  applyFilter();
}

function row(q: ReviewQuestion, a: ReviewAnswer | undefined, isViewer: boolean, showAudio: boolean): string {
  const status = a?.correct ? 'right' : 'wrong';
  const reading = q.reading === q.word ? '' : `<span class="review-reading">${esc(q.reading)}</span>`;
  const audio = showAudio
    ? `<button type="button" class="icon-btn" data-index="${q.index}" aria-label="Play pronunciation">🔊</button>`
    : '';
  const meta = a ? `${a.points ? `+${a.points}` : '0'} pts · ${(a.elapsedMs / 1000).toFixed(1)} s` : '';
  const right = `<div class="review-line ok">✓ ${esc(q.correctMeaning)}</div>`;

  let lines = right;
  if (!a?.correct) {
    const label = isViewer ? 'Your answer' : 'Answer';
    const given = !a
      ? '– Not answered'
      : a.timedOut || a.chosenMeaning === null
        ? "✗ Time's up"
        : `✗ ${label}: ${esc(a.chosenMeaning)}`;
    lines = `<div class="review-line ko">${given}</div>${right}`;
  }

  return `<li class="review-row ${status}">
    <div class="review-top">
      <span class="review-word"><span class="review-num">${q.index + 1}.</span> ${esc(q.word)} ${reading} ${audio}</span>
      <span class="review-meta">${meta}</span>
    </div>
    ${lines}
  </li>`;
}

function applyFilter(): void {
  list.classList.toggle('only-mistakes', onlyMistakes.checked);
  const mistakes = list.querySelectorAll('.review-row.wrong').length;
  empty.hidden = !(onlyMistakes.checked && mistakes === 0);
}

onlyMistakes.addEventListener('change', applyFilter);

list.addEventListener('click', (event) => {
  const btn = (event.target as HTMLElement).closest<HTMLElement>('[data-index]');
  const q = btn && shown?.questions[Number(btn.dataset.index)];
  if (q) speak(q, { force: true });
});
