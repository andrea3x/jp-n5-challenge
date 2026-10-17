// Types and constants shared between server and client.

export const WORD_COUNTS = [5, 10, 20, 30, 50, 100] as const;
export type WordCount = (typeof WORD_COUNTS)[number];

export const MAX_PLAYERS = 10;
export const MAX_NAME_LENGTH = 20;
export const TIMER_MIN_SECONDS = 2;
export const TIMER_MAX_SECONDS = 60;
export const DEFAULT_TIMER_SECONDS = 5;
/** Quick picks offered on the setup screen (all within the MIN–MAX range the server accepts). */
export const TIMER_CHOICES = [3, 5, 10, 15, 20, 30] as const;

export interface GameSettings {
  wordCount: WordCount;
  speedScoring: boolean;
  colorFeedback: boolean;
  /** With colorFeedback: also highlight the correct choice after a mistake or timeout. */
  revealCorrect: boolean;
  /** With colorFeedback: keep a wrong answer on screen longer (never affects time or score). */
  longerPauseOnMistake: boolean;
  timerEnabled: boolean;
  timerSeconds: number;
  pronounce: boolean;
  /** After the game, players can go through their answers. */
  answerReview: boolean;
}

export type Phase = 'lobby' | 'playing' | 'finished';

export interface PlayerSummary {
  id: string;
  name: string;
  isHost: boolean;
  connected: boolean;
  answered: number;
  finished: boolean;
}

export interface FinalResult {
  playerId: string;
  name: string;
  rank: number;
  score: number;
  correct: number;
  answered: number;
  totalTimeMs: number;
}

export interface RoomState {
  roomId: string;
  phase: Phase;
  settings: GameSettings;
  total: number;
  players: PlayerSummary[];
  results: FinalResult[] | null;
}

export interface QuestionPayload {
  index: number;
  total: number;
  word: string;
  reading: string;
  choices: string[];
  /** Pre-generated pronunciation; null when voice is off or no file exists (the client falls back to speech synthesis). */
  audioUrl: string | null;
  /** Full time limit for the question, null when the timer is disabled. */
  timeLimitMs: number | null;
  /** Time left when the question is delivered (less than the limit after a reconnect). */
  remainingMs: number | null;
}

/**
 * `correct` and `score` are only sent when color feedback is enabled;
 * `correctChoice` only when the correct answer is revealed too.
 */
export interface AnswerResult {
  ok: boolean;
  error?: string;
  correct?: boolean;
  correctChoice?: number;
  score?: number;
}

// Answer review. Questions are shared by all players and answers are per player, so the same
// shape serves one player's review today and every player's review if visibility is widened.

export interface ReviewQuestion {
  index: number;
  word: string;
  reading: string;
  correctMeaning: string;
  audioUrl: string | null;
}

export interface ReviewAnswer {
  index: number;
  /** null when no choice was made in time. */
  chosenMeaning: string | null;
  correct: boolean;
  timedOut: boolean;
  points: number;
  elapsedMs: number;
}

export interface PlayerReview {
  playerId: string;
  name: string;
  /** In question order; questions without an entry were not answered (game ended early). */
  answers: ReviewAnswer[];
}

export interface GameReview {
  questions: ReviewQuestion[];
  players: PlayerReview[];
}

export interface ReviewRequest {
  /** Whose answers to return; ids the viewer may not see are left out. */
  playerIds: string[];
}

export type ReviewResponse = { ok: true; review: GameReview } | { ok: false; error: string };

export interface CreateRoomResponse {
  roomId: string;
  hostKey: string;
}

export interface JoinRequest {
  roomId: string;
  name?: string;
  token?: string;
  hostKey?: string;
}

export type JoinResponse =
  | { ok: true; playerId: string; token: string }
  | { ok: false; error: string };

export interface AnswerRequest {
  index: number;
  choice: number | null;
}

export interface ClientToServerEvents {
  join: (req: JoinRequest, ack: (res: JoinResponse) => void) => void;
  start: () => void;
  next: (ack: (question: QuestionPayload | null) => void) => void;
  answer: (req: AnswerRequest, ack: (res: AnswerResult) => void) => void;
  endGame: () => void;
  playAgain: () => void;
  getReview: (req: ReviewRequest, ack: (res: ReviewResponse) => void) => void;
}

export interface ServerToClientEvents {
  room: (state: RoomState) => void;
}
