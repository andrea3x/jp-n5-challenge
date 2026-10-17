// Types and constants shared between server and client.

export const WORD_COUNTS = [10, 20, 30, 50, 70, 100] as const;
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
  timerEnabled: boolean;
  timerSeconds: number;
  pronounce: boolean;
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

/** Correctness details are only sent when color feedback is enabled. */
export interface AnswerResult {
  ok: boolean;
  error?: string;
  correct?: boolean;
  correctChoice?: number;
  score?: number;
}

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
}

export interface ServerToClientEvents {
  room: (state: RoomState) => void;
}
