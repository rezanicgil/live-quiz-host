# Protocol

Three interfaces: audience events going into the show, the WebSocket stream going out to the stage, and the HTTP API used
by the operator panel.

## 1. Audience events (source → show)

Every event is a plain object. `user` is `{ id, nick }`; `id` must be stable for a viewer within a session.

| `type` | Fields | Meaning |
|---|---|---|
| `join` | `user` | A viewer arrived. Greeted once per show. |
| `chat` | `user`, `text`, `at`? | A chat message. Judged as a guess first, then as chat. |
| `like` | `user`, `count`? | Applause. Fills the applause meter; a full meter triggers a cheer. |
| `follow` | `user` | Thanked once per viewer. |
| `share` | `user` | Thanked, with a cooldown per viewer. |
| `viewers` | `count` | Current concurrent viewers, as reported by the platform. |

`at` is the time the platform received the message, in milliseconds since the epoch. It is optional. When every answer in
a photo finish carries it, they are ranked by it; otherwise arrival order is used.

### Source modules

```js
// my-source.js
export function createSource({ onEvent, onStatus }) {
  return {
    async connect() { onStatus({ state: 'connected', detail: 'my chat' }); /* call onEvent(event) as messages arrive */ },
    async disconnect() {},
  };
}
```

Start the show with `SHOW_SOURCE=./my-source.js` (or set `show.source` in `config.json`). `onStatus` takes
`{ state, detail }` where `state` is one of `connecting`, `waiting`, `connected`, `warning`, `ended`. With no source the
state is `idle`, which is normal: events then come from the panel or from `POST /api/sim`. Demo mode ignores the source.

## 2. Stage stream (show → stage)

The stage opens `ws://host/ws` and only listens. Each message is a JSON object with a `t` field.

### `hello`

Sent on connect and whenever the show is rebuilt. `{ t, build, demo, title, host: { name } }`. A changed `build` tells
an open stage that the server restarted.

### `state`

The full picture, sent twice a second and after every batch of effects. A stage that connects mid-show can draw
everything from one `state`.

| Field | Type | Notes |
|---|---|---|
| `phase` | `lobby` · `intro` · `ask` · `solved` · `timeout` · `podium` · `break` · `ended` | |
| `round`, `index`, `total` | numbers | Round number, question number in the round, questions per round |
| `double` | boolean | The open question is worth double |
| `q` | object or `null` | `{ type, category, clue, hint, plate, emoji, scramble, tiles }`. `tiles[i]` is `{ ch, space }`; `ch` is `null` until that letter is open. The answer itself is never in `state`. |
| `outcomes` | array | How each question of the round ended, for the progress dots |
| `takingGuesses` | boolean | False while paused or during a photo finish |
| `nextHintIn` | number or `null` | Seconds until the next letter opens |
| `timeLeft`, `timeTotal` | numbers | Seconds for the current phase |
| `graceLeft` | number | Seconds left for late correct answers after a question is solved |
| `winners` | array | During `solved`: `{ user, rank, points, behind? }`. `behind` is milliseconds after the first answer. |
| `leaders` | array | Top five of the round: `{ id, nick, points, title }` |
| `podium` | array | Round standings, during `podium` and `break` |
| `finalists` | array | Top three of the whole show, only in `ended` |
| `night` | object | Running totals for the show, such as questions solved and the record |
| `highlights` | object | `{ active, streak, fast, firstTimers }` for the ticker |
| `chat` | string or `null` | The question the host asked the chat, while it is listening for answers |
| `viewers` | number | |
| `likes` | `{ count, fill }` | `fill` is the applause meter, 0 to 1 |
| `live` | `{ state, detail }` | Source status, see above |
| `demo`, `paused` | booleans | |
| `settings` | `{ volumes, look, murmur }` | What the stage needs from the operator's settings |

### `fx`

`{ t: 'fx', list: [...] }`. Effects are one-off events for animation and sound. They are never needed to reconstruct
state.

| `type` | Fields | When |
|---|---|---|
| `lobby` | | Show opening starts |
| `roundStart` | `round` | |
| `questionStart` | `index`, `total`, `qtype`, `category`, `double` | Category card |
| `reveal` | `pos`, `ch`, `open`, `left` | A letter opened |
| `guess` | `user`, `text`, `verdict` | A guess to show in the guess strip; `verdict` is `wrong`, `near` or `late` |
| `solved` | `user`, `rank`, `points`, `open`, `streak`, `first`, `fast`, `double` | First correct answer, after the photo finish |
| `alsoCorrect` | `user`, `rank`, `points`, `behind`? | Second and third place |
| `others` | `count` | How many more answered correctly in the grace window |
| `answer` | `answer`, `winners` | The grace window closed; the only message that carries the answer |
| `timeout` | `answer` | Nobody got it |
| `questionEnd` | `answer`, `fact`, `winners` | |
| `levelUp` | `user`, `title` | A returning player earned a new title |
| `record` | `solved` | The show passed its previous record of solved questions |
| `roundEnd` | `round`, `podium`, `champion` | |
| `breakStart` | | |
| `join`, `follow`, `share` | `user` (+ `returning`, `title` on `join`) | Audience events worth a visual |
| `like` | `user`, `count` | Throttled per viewer |
| `cheer` | | The applause meter filled |
| `catHello` | | Operator asked the host to wave |

### `say`

One line of the host, sent at the moment it should start.

| Field | Notes |
|---|---|
| `id`, `kind` | Sequence number and the kind of line (`ipucu`, `bildi`, `hosgeldin`, …) |
| `text` | Subtitle |
| `speech` | The words in the audio, which can differ from the subtitle when a fallback clip is used |
| `url`, `ms` | Audio file and its length. `url` is `null` when there is no audio; `ms` is then an estimate for the subtitle. |
| `emotion`, `gesture` | Drive the character's face and body |
| `voiceEnabled`, `allowSystemVoice` | Whether the stage may fall back to the browser's own voice |
| `speechProvider`, `voice` | Which voice produced the audio |
| `waited` | Milliseconds the host stayed silent with lines waiting, for measurement |

## 3. HTTP API (panel → show)

The server listens on localhost. Everything except reading the stage is refused from other machines.

| Call | Body | Does |
|---|---|---|
| `GET /api/boot` | | `{ mode, build, demo, title, host }` |
| `GET /api/state` | | `state` plus full `settings`, recent `log`, `participation`, and `tts`, `ai`, `bank` status |
| `POST /api/sim` | `{ type, nick, text?, count?, at? }` | Injects an audience event. `type` is `join`, `chat`, `like`, `follow`, `share`, or `answer` (posts the correct answer of the open question, for rehearsals). |
| `POST /api/cmd` | `{ type, ... }` | `pause`, `skip`, `restart`, `finish`, `demo` (`on`), `settings` (any of `look`, `murmur`, `pace`, `delivery`, `pocketVoice`, `volumes`, `followReminder`, `spokenFacts`, `ai`), `catHello`, `murmurTest` |
| `POST /api/voice-preview` | `{ sample? }` | Synthesizes a sample line and returns `{ url, ms, text }` |
| `POST /api/claude-key` | `{ key }` | Sets the Anthropic key for this session only. Localhost and same-origin only. |
| `GET /tts/<sha1>.wav` | | A cached voice clip |
