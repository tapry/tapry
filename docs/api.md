# API and webhooks

Tapry's app talks to its server through an HTTP API, and your own scripts can use the same one
with an API key. Webhooks tell your server when a recording is ready, so nothing has to poll.

This covers what a key can do. The API has no version number yet: it is the app's own API, and
it changes with the app. The [changelog](../CHANGELOG.md) says when something a key can reach changes.

## Keys

The account's owner makes keys in **Settings, Account**. A key is shown once; only its hash is
stored. Send it as a bearer token:

```bash
curl -H "Authorization: Bearer tpk_..." https://studio.example.com/api/studios
```

A key acts as a member of the account, named after the key in comments and the activity log.
It reads everything a member can read. It can change only what is listed below; it can never
touch the plan, the members, own storage, other keys or webhooks, and it cannot host a session.
Each key may make 300 requests a minute (then `429`). Revoking a key stops it at once.

Errors are JSON: `{ "error": "<code>", "message": "<words>" }`.

## Reading

| Request | Gives |
|---|---|
| `GET /api/studios` | `{ studios: [...] }`: each studio's id, name, invite code and settings |
| `GET /api/studios/:studioId` | One studio |
| `GET /api/studios/:studioId/recordings` | `{ recordings: [...] }`: status, times, people, and `outputs` (id, kind, fileName, bytes) |
| `GET /api/recordings` | Recordings across all studios |
| `GET /api/recordings/:recordingId` | One recording |
| `GET /api/recordings/:recordingId/transcript` | The transcript as turns: speaker, start, text |
| `GET /api/studios/:studioId/recordings/:recordingId/outputs/:outputId` | Redirects (302) to a signed link to the file, valid for a short time. Follow it: `curl -L` |
| `GET /api/studios/:studioId/recordings/:recordingId/zip` | Every file of the recording as one zip, with the timeline projects and the consent record |
| `GET /api/studios/:studioId/recordings/:recordingId/consent` | The consent record as text |
| `GET /api/studios/:studioId/recordings/:recordingId/timeline/:format` | A timeline project: `otio`, `fcpxml` or `rpp`. Add `?pauses=out` for the version without long pauses |
| `GET /api/studios/:studioId/recordings/:recordingId/clips` | Its clips |
| `GET /api/recordings/:recordingId/comments` | Its comments |
| `GET /api/transcripts?q=words` | Recordings whose transcript contains the words |
| `GET /api/guests` | Everyone who recorded as a guest |
| `GET /api/storage` | Space used, per studio |
| `GET /api/usage` | Recordings, recorded time, guests and transcripts: in all, and for each of the last 12 months |
| `GET /api/studios/:studioId/brand` | The studio's accent colour and logo address for guest pages |

Output kinds: `audio`, `video`, `screen` (one per person), `combined`, `transcript`, `notes`, `clip`.

## Changing

| Request | Does |
|---|---|
| `POST /api/studios` `{ name, settings? }` | Creates a studio |
| `PATCH /api/studios/:studioId` `{ name?, settings? }` | Renames it or changes settings |
| `POST /api/studios/:studioId/invite` | Replaces the invite link (the old one stops working) |
| `PUT /api/studios/:studioId/guide` `{ guide }` | Sets the host's guide |
| `PUT /api/studios/:studioId/solo` `{ enabled, prompt }` | Turns the solo link on or off and sets its questions |
| `POST /api/studios/:studioId/recordings/:recordingId/process` | Makes the files again |
| `DELETE /api/studios/:studioId/recordings/:recordingId` | Deletes a stopped recording and its files |
| `POST /api/studios/:studioId/recordings/:recordingId/clips` `{ startMs, endMs, title? }` | Cuts a clip |
| `DELETE /api/studios/:studioId/recordings/:recordingId/clips/:clipId` | Deletes a clip |
| `POST /api/studios/:studioId/recordings/:recordingId/notes` | Writes AI notes (again), where the account has them on |
| `POST /api/recordings/:recordingId/comments` `{ body, atMs? }` | Adds a comment |
| `POST /api/recordings/:recordingId/transcript/safe` `{ format, pseudonyms, contacts, terms }` | Returns a share-safe copy of the transcript |

Everything else a person can do in the app (hosting, members, the plan, storage, keys, webhooks,
deleting a studio) answers `403 not_for_keys`.

## Webhooks

The owner adds addresses in **Settings, Account**. An address must be public `https`. Each gets
a signing secret, shown once.

Tapry sends a `POST` with a JSON body when:

- `recording.ready`: the recording's files have been made
- `recording.transcribed`: its transcript is ready

```json
{
  "id": "whd_...",
  "event": "recording.ready",
  "createdAt": "2026-11-13T21:45:51.000Z",
  "recording": {
    "id": "rec_...",
    "number": 12,
    "studio": { "id": "std_...", "name": "Interviews" },
    "startedAt": "2026-11-13T20:00:00.000Z",
    "stoppedAt": "2026-11-13T20:42:17.000Z",
    "files": [{ "id": "out_...", "kind": "audio", "fileName": "Ines - audio.wav", "bytes": 242000000 }]
  }
}
```

It never contains media, transcript text or anyone's contact details. Fetch files with a key
and the output request above.

Answer with any `2xx` within 10 seconds. Anything else is tried again, further apart each time
(1, 2, 4 … minutes, at most 6 hours), 8 times in all; then the delivery is given up and
Settings shows that the last message couldn't be delivered. A delivery can arrive more than
once: use its `id` to ignore repeats.

### Checking the signature

Each request has a header:

```
Tapry-Signature: t=1794591951,v1=5f3c…
```

`v1` is the hex HMAC-SHA256 of `"<t>.<raw request body>"` with your signing secret. Compute it
over the body exactly as received, compare in constant time, and refuse a `t` more than a few
minutes old.

```js
import { createHmac, timingSafeEqual } from "node:crypto";

function verify(secret, header, rawBody) {
  const { t, v1 } = Object.fromEntries(header.split(",").map((p) => p.split("=")));
  const expected = createHmac("sha256", secret).update(`${t}.${rawBody}`).digest("hex");
  const fresh = Math.abs(Date.now() / 1000 - Number(t)) < 300;
  return fresh && expected.length === v1.length && timingSafeEqual(Buffer.from(expected), Buffer.from(v1));
}
```
