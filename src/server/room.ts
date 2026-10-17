import { randomBytes } from 'node:crypto';
import {
  MAX_NAME_LENGTH,
  MAX_PLAYERS,
  type AnswerResult,
  type FinalResult,
  type GameSettings,
  type JoinRequest,
  type Phase,
  type PlayerReview,
  type QuestionPayload,
  type ReviewResponse,
  type RoomState,
} from '../shared/protocol.js';
import { buildQuestions, type Question } from './questions.js';
import type { Word } from './vocabulary.js';

const BASE_POINTS = 100;
const MAX_SPEED_BONUS = 100;
/** Window over which the speed bonus decays when the timer is disabled. */
const SPEED_WINDOW_WITHOUT_TIMER_MS = 10_000;
/** Tolerance for network latency before an answer counts as late. */
const LATE_ANSWER_GRACE_MS = 1_000;

export function randomId(bytes: number): string {
  return randomBytes(bytes).toString('base64url');
}

interface Answer {
  choice: number | null;
  correct: boolean;
  points: number;
  elapsedMs: number;
}

export class Player {
  readonly id = randomId(6);
  readonly token = randomId(18);
  socketId: string | null = null;
  answers: Answer[] = [];
  /** When the current question was delivered; null if no question is pending. */
  pendingSince: number | null = null;

  constructor(readonly name: string) {}

  get connected(): boolean {
    return this.socketId !== null;
  }

  get score(): number {
    return this.answers.reduce((sum, a) => sum + a.points, 0);
  }

  get correctCount(): number {
    return this.answers.filter((a) => a.correct).length;
  }

  get totalTimeMs(): number {
    return this.answers.reduce((sum, a) => sum + a.elapsedMs, 0);
  }

  reset(): void {
    this.answers = [];
    this.pendingSince = null;
  }
}

export type JoinOutcome = { player: Player } | { error: string };

export class Room {
  readonly hostKey = randomId(18);
  phase: Phase = 'lobby';
  players: Player[] = [];
  hostId: string | null = null;
  lastActivity = Date.now();
  private questions: Question[] = [];
  private finalResults: FinalResult[] | null = null;

  constructor(
    readonly id: string,
    readonly settings: GameSettings,
  ) {}

  private get timeLimitMs(): number | null {
    return this.settings.timerEnabled ? this.settings.timerSeconds * 1000 : null;
  }

  touch(): void {
    this.lastActivity = Date.now();
  }

  playerBySocket(socketId: string): Player | undefined {
    return this.players.find((p) => p.socketId === socketId);
  }

  isHost(player: Player): boolean {
    return this.hostId === player.id;
  }

  join(req: JoinRequest, socketId: string): JoinOutcome {
    this.touch();

    const existing = req.token ? this.players.find((p) => p.token === req.token) : undefined;
    if (existing) {
      existing.socketId = socketId;
      this.claimHost(existing, req.hostKey);
      return { player: existing };
    }

    if (this.phase !== 'lobby') return { error: 'The game has already started.' };
    if (this.players.length >= MAX_PLAYERS) return { error: `The room is full (max ${MAX_PLAYERS} players).` };

    const name = (req.name ?? '').trim().slice(0, MAX_NAME_LENGTH);
    if (!name) return { error: 'Please enter a name.' };
    if (this.players.some((p) => p.name.toLowerCase() === name.toLowerCase())) {
      return { error: 'That name is already taken.' };
    }

    const player = new Player(name);
    player.socketId = socketId;
    this.players.push(player);
    this.claimHost(player, req.hostKey);
    return { player };
  }

  /** The host key always grants the host role; otherwise the role goes to anyone if nobody connected holds it. */
  private claimHost(player: Player, hostKey: string | undefined): void {
    const host = this.players.find((p) => p.id === this.hostId);
    if (hostKey === this.hostKey || !host?.connected) this.hostId = player.id;
  }

  leave(player: Player): void {
    this.touch();
    player.socketId = null;
    // In the lobby a disconnected player simply leaves; the client re-joins by name after a refresh.
    if (this.phase === 'lobby') this.players = this.players.filter((p) => p !== player);
    if (this.hostId === player.id) {
      this.hostId = this.players.find((p) => p.connected)?.id ?? this.hostId;
    }
    this.checkFinished();
  }

  start(vocabulary: Word[], audioUrls: Map<Word, string>): boolean {
    if (this.phase !== 'lobby' || this.players.length === 0) return false;
    this.touch();
    this.questions = buildQuestions(vocabulary, this.settings.wordCount, audioUrls);
    this.players.forEach((p) => p.reset());
    this.finalResults = null;
    this.phase = 'playing';
    return true;
  }

  isFinished(player: Player): boolean {
    return this.questions.length > 0 && player.answers.length >= this.questions.length;
  }

  /** Delivers the player's current question, re-sending it with the remaining time if it is already pending. */
  nextQuestion(player: Player): QuestionPayload | null {
    if (this.phase !== 'playing' || this.isFinished(player)) return null;
    this.touch();

    const now = Date.now();
    const limit = this.timeLimitMs;
    if (player.pendingSince === null) {
      player.pendingSince = now;
    } else if (limit !== null && now - player.pendingSince >= limit) {
      // The question expired while the player was away: count it as wrong and move on.
      this.record(player, null, limit);
      return this.nextQuestion(player);
    }

    const index = player.answers.length;
    const q = this.questions[index];
    return {
      index,
      total: this.questions.length,
      word: q.word,
      reading: q.reading,
      choices: q.choices,
      audioUrl: this.settings.pronounce ? q.audioUrl : null,
      timeLimitMs: limit,
      remainingMs: limit === null ? null : limit - (now - player.pendingSince),
    };
  }

  submitAnswer(player: Player, index: number, choice: number | null): AnswerResult {
    if (this.phase !== 'playing') return { ok: false, error: 'The game is not running.' };
    if (index !== player.answers.length || player.pendingSince === null) {
      return { ok: false, error: 'Answer out of sync.' };
    }
    this.touch();

    const q = this.questions[index];
    const limit = this.timeLimitMs;
    const elapsed = Date.now() - player.pendingSince;
    const late = limit !== null && elapsed > limit + LATE_ANSWER_GRACE_MS;
    const validChoice = Number.isInteger(choice) && choice! >= 0 && choice! < q.choices.length ? choice : null;
    const answer = this.record(player, late ? null : validChoice, limit === null ? elapsed : Math.min(elapsed, limit));

    if (!this.settings.colorFeedback) return { ok: true };
    const result: AnswerResult = { ok: true, correct: answer.correct, score: player.score };
    if (this.settings.revealCorrect) result.correctChoice = q.answer;
    return result;
  }

  private record(player: Player, choice: number | null, elapsedMs: number): Answer {
    const q = this.questions[player.answers.length];
    const correct = choice === q.answer;
    let points = 0;
    if (correct) {
      points = BASE_POINTS;
      if (this.settings.speedScoring) {
        const window = this.timeLimitMs ?? SPEED_WINDOW_WITHOUT_TIMER_MS;
        points += Math.round(MAX_SPEED_BONUS * Math.max(0, 1 - elapsedMs / window));
      }
    }
    const answer: Answer = { choice, correct, points, elapsedMs };
    player.answers.push(answer);
    player.pendingSince = null;
    return answer;
  }

  /** Ends the game once every connected player is done (and at least one player finished). */
  checkFinished(): boolean {
    if (this.phase !== 'playing') return false;
    const anyFinished = this.players.some((p) => this.isFinished(p));
    const allDone = this.players.every((p) => this.isFinished(p) || !p.connected);
    if (!anyFinished || !allDone) return false;
    this.finish();
    return true;
  }

  finish(): void {
    if (this.phase !== 'playing') return;
    this.phase = 'finished';
    this.finalResults = [...this.players]
      .sort((a, b) => b.score - a.score || b.correctCount - a.correctCount || a.totalTimeMs - b.totalTimeMs)
      .map((p, i) => ({
        playerId: p.id,
        name: p.name,
        rank: i + 1,
        score: p.score,
        correct: p.correctCount,
        answered: p.answers.length,
        totalTimeMs: p.totalTimeMs,
      }));
  }

  /**
   * The only rule deciding whose answers a player may review.
   * Today: your own, once the game is over. Widening it (e.g. to everyone) only changes this method.
   */
  canViewReview(viewer: Player, target: Player): boolean {
    return this.phase === 'finished' && this.settings.answerReview && viewer === target;
  }

  review(viewer: Player, playerIds: string[]): ReviewResponse {
    if (!this.settings.answerReview) return { ok: false, error: 'Answer review is disabled for this game.' };
    if (this.phase !== 'finished') return { ok: false, error: 'The review is available when the game is over.' };

    const requested = new Set(playerIds);
    const players: PlayerReview[] = this.players
      .filter((p) => requested.has(p.id) && this.canViewReview(viewer, p))
      .map((p) => ({
        playerId: p.id,
        name: p.name,
        answers: p.answers.map((a, index) => ({
          index,
          chosenMeaning: a.choice === null ? null : this.questions[index].choices[a.choice],
          correct: a.correct,
          timedOut: a.choice === null,
          points: a.points,
          elapsedMs: a.elapsedMs,
        })),
      }));

    return {
      ok: true,
      review: {
        questions: this.questions.map((q, index) => ({
          index,
          word: q.word,
          reading: q.reading,
          correctMeaning: q.choices[q.answer],
          audioUrl: this.settings.pronounce ? q.audioUrl : null,
        })),
        players,
      },
    };
  }

  /** Back to the lobby with the same settings and the players still connected. */
  playAgain(): void {
    if (this.phase !== 'finished') return;
    this.touch();
    this.phase = 'lobby';
    this.questions = [];
    this.finalResults = null;
    this.players = this.players.filter((p) => p.connected);
    this.players.forEach((p) => p.reset());
    if (!this.players.some((p) => p.id === this.hostId)) this.hostId = this.players[0]?.id ?? null;
  }

  toState(): RoomState {
    return {
      roomId: this.id,
      phase: this.phase,
      settings: this.settings,
      total: this.phase === 'lobby' ? this.settings.wordCount : this.questions.length,
      players: this.players.map((p) => ({
        id: p.id,
        name: p.name,
        isHost: this.isHost(p),
        connected: p.connected,
        answered: p.answers.length,
        finished: this.isFinished(p),
      })),
      results: this.finalResults,
    };
  }
}
