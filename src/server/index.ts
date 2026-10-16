import { createServer } from 'node:http';
import path from 'node:path';
import express from 'express';
import { Server, type Socket } from 'socket.io';
import {
  DEFAULT_TIMER_SECONDS,
  TIMER_MAX_SECONDS,
  TIMER_MIN_SECONDS,
  WORD_COUNTS,
  type ClientToServerEvents,
  type CreateRoomResponse,
  type GameSettings,
  type ServerToClientEvents,
  type WordCount,
} from '../shared/protocol.js';
import { Room, randomId } from './room.js';
import { loadVocabulary } from './vocabulary.js';

const PORT = Number(process.env.PORT ?? 3000);
const ROOT = path.resolve(import.meta.dirname, '..', '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const ROOM_TTL_MS = 2 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

const vocabulary = loadVocabulary();
const rooms = new Map<string, Room>();

const app = express();
app.use(express.json({ limit: '4kb' }));
app.use(express.static(PUBLIC_DIR, { index: false }));

app.get('/', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.get('/r/:roomId', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'room.html')));

app.post('/api/rooms', (req, res) => {
  const settings = parseSettings(req.body);
  if (!settings) {
    res.status(400).json({ error: 'Invalid game settings.' });
    return;
  }
  let id: string;
  do id = randomId(4).replace(/[-_]/g, 'x'); while (rooms.has(id));
  const room = new Room(id, settings);
  rooms.set(id, room);
  res.json({ roomId: id, hostKey: room.hostKey } satisfies CreateRoomResponse);
});

function parseSettings(body: unknown): GameSettings | null {
  if (typeof body !== 'object' || body === null) return null;
  const b = body as Record<string, unknown>;
  if (!WORD_COUNTS.includes(b.wordCount as WordCount)) return null;
  const timerSeconds = b.timerSeconds === undefined ? DEFAULT_TIMER_SECONDS : Number(b.timerSeconds);
  if (!Number.isInteger(timerSeconds) || timerSeconds < TIMER_MIN_SECONDS || timerSeconds > TIMER_MAX_SECONDS) {
    return null;
  }
  return {
    wordCount: b.wordCount as WordCount,
    speedScoring: b.speedScoring !== false,
    colorFeedback: b.colorFeedback !== false,
    timerEnabled: b.timerEnabled !== false,
    timerSeconds,
  };
}

const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer);

function broadcast(room: Room): void {
  io.to(room.id).emit('room', room.toState());
}

io.on('connection', (socket: Socket<ClientToServerEvents, ServerToClientEvents>) => {
  let room: Room | undefined;

  /** Resolves the caller's player, or undefined if the socket has not joined a room. */
  const me = () => room?.playerBySocket(socket.id);
  const isHost = () => {
    const player = me();
    return room !== undefined && player !== undefined && room.isHost(player);
  };

  socket.on('join', (req, ack) => {
    if (typeof ack !== 'function') return;
    if (room) {
      ack({ ok: false, error: 'Already joined.' });
      return;
    }
    const target = rooms.get(String(req?.roomId ?? ''));
    if (!target) {
      ack({ ok: false, error: 'This game does not exist (or has expired).' });
      return;
    }
    const outcome = target.join(req, socket.id);
    if ('error' in outcome) {
      ack({ ok: false, error: outcome.error });
      return;
    }
    room = target;
    socket.join(room.id);
    ack({ ok: true, playerId: outcome.player.id, token: outcome.player.token });
    broadcast(room);
  });

  socket.on('start', () => {
    if (room && isHost() && room.start(vocabulary)) broadcast(room);
  });

  socket.on('next', (ack) => {
    const player = me();
    if (typeof ack !== 'function' || !room || !player) return;
    const answeredBefore = player.answers.length;
    ack(room.nextQuestion(player));
    // An expired question may have been recorded as a timeout.
    if (player.answers.length !== answeredBefore) {
      room.checkFinished();
      broadcast(room);
    }
  });

  socket.on('answer', (req, ack) => {
    const player = me();
    if (typeof ack !== 'function' || !room || !player) return;
    const result = room.submitAnswer(player, Number(req?.index), req?.choice ?? null);
    ack(result);
    if (result.ok) {
      room.checkFinished();
      broadcast(room);
    }
  });

  socket.on('endGame', () => {
    if (!room || !isHost()) return;
    room.finish();
    broadcast(room);
  });

  socket.on('playAgain', () => {
    if (!room || !isHost()) return;
    room.playAgain();
    broadcast(room);
  });

  socket.on('disconnect', () => {
    const player = me();
    if (!room || !player) return;
    room.leave(player);
    broadcast(room);
  });
});

setInterval(() => {
  const cutoff = Date.now() - ROOM_TTL_MS;
  for (const [id, room] of rooms) {
    if (room.lastActivity < cutoff) rooms.delete(id);
  }
}, CLEANUP_INTERVAL_MS).unref();

// Rooms live in memory, so there is nothing to flush: exit promptly (e.g. on `docker stop`).
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => io.close(() => process.exit(0)));
}

httpServer.listen(PORT, () => {
  console.log(`Loaded ${vocabulary.length} words. Listening on http://localhost:${PORT}`);
});
