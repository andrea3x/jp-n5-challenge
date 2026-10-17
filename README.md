# N5 Challenge

Multiplayer JLPT N5 vocabulary quiz (TypeScript, Node.js, Express, Socket.IO).

The host picks the number of words (10–100) and the options, then shares the link. Up to 10 players join a lobby, the host presses Start, and everyone answers the same words at their own pace. The podium appears when everyone has finished, or when the host ends the game early.

## Commands

```sh
npm install
npm run build     # bundles the client (esbuild) and compiles the server (tsc)
npm start         # http://localhost:3000 (set PORT to change it)
npm run dev       # watch mode for client and server
npm run typecheck
```

## Scoring

- A correct answer is worth 100 points. A wrong answer or a timeout is worth 0.
- With the speed bonus enabled, a correct answer earns up to 100 extra points. The bonus decreases linearly over the time limit, or over 10 s when the timer is off.
- Ranking: points, then number of correct answers, then total answer time.

## Vocabulary data

`data/n5.json` is a JSON array, loaded once at startup:

```json
{ "word": "暇", "reading": "ひま", "meaning": "spare time, leisure" }
```

`meaning` must be unique across the file, because the 3 wrong choices of each question are drawn from the other words' meanings. The server refuses to start if the file is invalid.

## Pronunciation audio

Each word has a pre-generated MP3 in `public/audio/`, made with [VOICEVOX](https://voicevox.hiroshiba.jp/) (voice: VOICEVOX:四国めたん). Files are named after a hash of the word and its reading. If a file is missing or fails to play, the browser's speech synthesis reads the word instead.

After changing `data/n5.json`, generate the audio for the new words (existing files are kept):

```sh
podman run --rm -p 50021:50021 docker.io/voicevox/voicevox_engine:cpu-latest   # or docker
npm run audio     # needs ffmpeg; VOICEVOX_URL and VOICEVOX_SPEAKER can be overridden
```

If you change `VOICEVOX_SPEAKER`, also update the credit line in `public/room.html`, as required by the voice's terms of use.



## AI
This project is entirely made by Claude.
This is the prompt I used (translated to English) for the first commit of the app:

> Design a small web app using TypeScript, Node.js and Express.js. The goal is to run multiplayer challenges that test knowledge of JLPT N5 Japanese. The game interface should look like the attached screenshot. When setting up the game, the game master chooses how many words to play (10, 20, 30, 50, 70 or 100), and a link is generated. Up to 10 participants can join. Once everyone is connected, the game starts. Everyone gets the same words, nobody waits for anyone else, and each player progresses independently. Points are awarded for speed and for correct answers. Speed scoring can be turned off, leaving only points for correct answers; there's an option for this on the setup screen. Each time a player clicks an answer, it briefly turns green if it's right or red if it's wrong, then the game moves on to the next question. Another option on the setup screen lets the master turn off this right/wrong coloring. At the end of the game, there's a podium showing the scores. I'd like the words and their answers to be generated along with the code and saved in a format that's convenient and fast for Node.js to read. Suggest one. The code must be written in English. If you have any doubts, STOP AND ASK ME.



