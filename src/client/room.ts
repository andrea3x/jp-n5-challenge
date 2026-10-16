import { io, type Socket } from 'socket.io-client';
import {
  MAX_PLAYERS,
  type ClientToServerEvents,
  type FinalResult,
  type QuestionPayload,
  type RoomState,
  type ServerToClientEvents,
} from '../shared/protocol.js';
import { saveName, saveToken, savedHostKey, savedName, savedToken } from './storage.js';

type View = 'connecting' | 'join' | 'lobby' | 'countdown' | 'question' | 'waiting' | 'podium';

const FEEDBACK_MS = 700;
const NO_FEEDBACK_MS = 150;
const COUNTDOWN_FROM = 3;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const roomId = decodeURIComponent(location.pathname.split('/').pop() ?? '');
const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io();

const views: Record<Exclude<View, 'connecting'>, HTMLElement> = {
  join: $('view-join'),
  lobby: $('view-lobby'),
  countdown: $('view-countdown'),
  question: $('view-question'),
  waiting: $('view-waiting'),
  podium: $('view-podium'),
};

let view: View = 'connecting';
let myId: string | null = null;
let state: RoomState | null = null;
let current: QuestionPayload | null = null;
let locked = false;
let myScore: number | null = null;
let timers: number[] = [];

// ---------- helpers ----------

function show(next: View, bubble: string): void {
  view = next;
  for (const [name, el] of Object.entries(views)) el.hidden = name !== next;
  $('bubble').textContent = bubble;
}

function showError(message: string | null): void {
  const box = $('error');
  box.textContent = message ?? '';
  box.hidden = !message;
}

function clearTimers(): void {
  timers.forEach((t) => clearTimeout(t));
  timers = [];
}

function later(fn: () => void, ms: number): void {
  timers.push(window.setTimeout(fn, ms));
}

function esc(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

const me = () => state?.players.find((p) => p.id === myId);
const amHost = () => me()?.isHost ?? false;

// ---------- connection ----------

socket.on('connect', () => {
  showError(null);
  join(savedName());
});

socket.on('disconnect', () => {
  showError('Connection lost, reconnecting…');
});

function join(name: string | undefined): void {
  const token = savedToken(roomId);
  if (!token && !name) {
    showJoinForm();
    return;
  }
  socket.emit('join', { roomId, name, token, hostKey: savedHostKey(roomId) }, (res) => {
    if (!res.ok) {
      showJoinForm(res.error);
      return;
    }
    myId = res.playerId;
    saveToken(roomId, res.token);
    // After a reconnect mid-question, fetch the current question again (with the time left).
    if (view === 'question') requestNext();
  });
}

function showJoinForm(error?: string): void {
  show('join', 'Enter your name to join the challenge!');
  showError(error ?? null);
  const input = $<HTMLInputElement>('join-name');
  input.value ||= savedName() ?? '';
  input.focus();
}

$<HTMLFormElement>('join-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const name = $<HTMLInputElement>('join-name').value.trim();
  if (!name) return;
  saveName(name);
  showError(null);
  join(name);
});

// ---------- room state ----------

socket.on('room', (next) => {
  state = next;
  if (!myId || !me()) return;

  switch (next.phase) {
    case 'lobby':
      showLobby(next);
      break;
    case 'playing':
      // While counting down or answering, the question flow drives the view.
      if (view === 'countdown' || view === 'question') return;
      if (me()!.finished) showWaiting(next);
      else if (view === 'lobby') startCountdown();
      else requestNext();
      break;
    case 'finished':
      showPodium(next.results ?? []);
      break;
  }
});

// ---------- lobby ----------

function showLobby(s: RoomState): void {
  clearTimers();
  show('lobby', amHost() ? 'Share the link, then press Start when everyone is here!' : 'Waiting for players…');

  $<HTMLInputElement>('share-link').value = `${location.origin}/r/${s.roomId}`;
  const { wordCount, speedScoring, colorFeedback, timerEnabled, timerSeconds } = s.settings;
  $('settings-summary').innerHTML = [
    `${wordCount} words`,
    `Speed bonus: ${speedScoring ? 'on' : 'off'}`,
    `Feedback colors: ${colorFeedback ? 'on' : 'off'}`,
    `Timer: ${timerEnabled ? `${timerSeconds} s` : 'off'}`,
  ]
    .map((item) => `<li>${item}</li>`)
    .join('');

  $('player-count').textContent = `(${s.players.length}/${MAX_PLAYERS})`;
  $('lobby-players').innerHTML = s.players
    .map(
      (p) =>
        `<li><span>${esc(p.name)}${p.isHost ? '<span class="tag">Host</span>' : ''}${
          p.id === myId ? '<span class="tag you">You</span>' : ''
        }</span></li>`,
    )
    .join('');

  $('start').hidden = !amHost();
  $('lobby-wait').hidden = amHost();
}

$('copy-link').addEventListener('click', async () => {
  const input = $<HTMLInputElement>('share-link');
  try {
    await navigator.clipboard.writeText(input.value);
  } catch {
    input.select();
    document.execCommand('copy');
  }
  $('copy-link').textContent = 'Copied!';
  setTimeout(() => ($('copy-link').textContent = 'Copy'), 1500);
});

$('start').addEventListener('click', () => socket.emit('start'));

// ---------- game ----------

function startCountdown(): void {
  clearTimers();
  myScore = 0;
  show('countdown', 'Get ready…');
  for (let i = 0; i < COUNTDOWN_FROM; i++) {
    later(() => ($('countdown-number').textContent = String(COUNTDOWN_FROM - i)), i * 1000);
  }
  later(() => {
    if (view === 'countdown') requestNext();
  }, COUNTDOWN_FROM * 1000);
}

function requestNext(): void {
  socket.emit('next', (q) => {
    if (state?.phase !== 'playing') return;
    if (q) showQuestion(q);
    else showWaiting(state);
  });
}

function showQuestion(q: QuestionPayload): void {
  clearTimers();
  current = q;
  locked = false;
  show('question', 'Choose the meaning of the word!');

  $('progress').textContent = `${q.index + 1} / ${q.total}`;
  $('score').textContent = state?.settings.colorFeedback && myScore !== null ? `${myScore} pts` : '';
  $('word').textContent = q.word;
  $('reading').textContent = q.reading === q.word ? '' : q.reading;

  const choices = $('choices');
  choices.innerHTML = '';
  q.choices.forEach((text, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn';
    btn.textContent = text;
    btn.addEventListener('click', () => submit(i));
    choices.append(btn);
  });

  startTimer(q);
}

function startTimer(q: QuestionPayload): void {
  const timer = $('timer');
  const bar = $('timer-bar');
  timer.hidden = q.timeLimitMs === null;
  if (q.timeLimitMs === null || q.remainingMs === null) return;

  const remaining = Math.max(0, q.remainingMs);
  bar.classList.remove('low');
  bar.style.transition = 'none';
  bar.style.width = `${(remaining / q.timeLimitMs) * 100}%`;
  void bar.offsetWidth; // restart the CSS transition
  bar.style.transition = `width ${remaining}ms linear`;
  bar.style.width = '0%';

  later(() => bar.classList.add('low'), Math.max(0, remaining - q.timeLimitMs / 3));
  later(() => submit(null), remaining);
}

function submit(choice: number | null): void {
  const q = current;
  if (locked || !q || view !== 'question') return;
  locked = true;
  clearTimers();

  const buttons = [...$('choices').querySelectorAll('button')];
  buttons.forEach((b) => (b.disabled = true));
  if (choice !== null) buttons[choice].classList.add('picked');
  const bar = $('timer-bar');
  bar.style.width = getComputedStyle(bar).width; // freeze the timer bar
  bar.style.transition = 'none';

  socket.emit('answer', { index: q.index, choice }, (res) => {
    if (view !== 'question' || current !== q) return;
    if (!res.ok) {
      requestNext(); // out of sync: ask the server where we are
      return;
    }

    let delay = NO_FEEDBACK_MS;
    if (res.correct !== undefined) {
      delay = FEEDBACK_MS;
      myScore = res.score ?? myScore;
      $('score').textContent = `${myScore} pts`;
      if (choice !== null) {
        buttons[choice].classList.remove('picked');
        buttons[choice].classList.add(res.correct ? 'correct' : 'wrong');
      } else if (res.correctChoice !== undefined) {
        buttons[res.correctChoice].classList.add('correct');
      }
    }
    later(() => {
      if (view === 'question' && current === q) requestNext();
    }, delay);
  });
}

// ---------- waiting ----------

function showWaiting(s: RoomState): void {
  clearTimers();
  current = null;
  show('waiting', 'Well done! Waiting for the others…');

  $('progress-list').innerHTML = s.players
    .map((p) => {
      const pct = s.total ? Math.round((p.answered / s.total) * 100) : 0;
      return `<li>
        <div class="row">
          <span>${esc(p.name)}${p.id === myId ? ' (you)' : ''}${p.connected ? '' : ' <span class="offline">(offline)</span>'}</span>
          <span>${p.answered} / ${s.total}</span>
        </div>
        <div class="bar${p.finished ? ' done' : ''}"><div style="width:${pct}%"></div></div>
      </li>`;
    })
    .join('');

  $('end-game').hidden = !amHost();
}

$('end-game').addEventListener('click', () => {
  if (confirm('End the game now for everyone?')) socket.emit('endGame');
});

// ---------- podium ----------

function showPodium(results: FinalResult[]): void {
  clearTimers();
  current = null;
  show('podium', 'Results!');

  const places: Array<[FinalResult | undefined, string]> = [
    [results[1], 'second'],
    [results[0], 'first'],
    [results[2], 'third'],
  ];
  $('podium').innerHTML = places
    .filter(([r]) => r)
    .map(
      ([r, cls]) => `<div class="step ${cls}">
        <div class="name">${esc(r!.name)}</div>
        <div class="points">${r!.score} pts</div>
        <div class="block">${r!.rank}</div>
      </div>`,
    )
    .join('');

  const total = state?.total ?? 0;
  $('ranking-body').innerHTML = results
    .map(
      (r) => `<tr class="${r.playerId === myId ? 'me' : ''}">
        <td>${r.rank}</td><td>${esc(r.name)}</td><td>${r.score}</td><td>${r.correct} / ${total}</td>
      </tr>`,
    )
    .join('');

  $('play-again').hidden = !amHost();
}

$('play-again').addEventListener('click', () => socket.emit('playAgain'));
