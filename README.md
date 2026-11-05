# Mixup

Mixup is a browser session for arranging audio with someone else. Everyone edits the same timeline, hears the arrangement on their own computer in time with the group, and can talk while they work.

WebRTC carries the voice and the edits. A small signaling server only introduces the browsers. Audio files stay on the computers in the room.

This version is the shared arrange view: import audio, cut and move clips, set volume, and press play together. A step sequencer and a MIDI piano roll are not in this version.

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:5173 in two browsers, or two profiles. Create a room in one, copy the link, and join from the other with a different name. Allow the microphone if you want to be heard.

Use headphones. Speakers feed the arrangement and the other person’s voice back into the mic.

Import wav, mp3, ogg, flac, or m4a up to 30 MB. Reloading the page restores that room’s arrangement and audio from this browser.

## Keyboard

| Key | Action |
| --- | --- |
| Space | Play or stop |
| S | Split the selected clip at the playhead |
| Delete or Backspace | Delete the selected clip |

Drag a clip to move it. Drag either edge to trim it. Click the ruler to seek. Selection stays on your computer; the edit itself is shared.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Signaling on port 8787 and the app on port 5173 |
| `npm test` | Signaling and document checks |
| `npm run build` | Typecheck the server and build the client |
| `npm start` | Run the built signaling server |

`PORT` changes the signaling port. `VITE_SIGNAL_URL` points the app at a different server, for example `ws://192.168.1.20:8787` on a LAN. See `.env.example`.

Node 18 or newer.

## How a session works

```text
browser A                         browser B
  mic, arrangement, playback        mic, arrangement, playback
        \                               /
         \---- WebRTC (encrypted) ----/
                     |
            signaling server
         room membership and SDP/ICE only
```

One peer connection per pair. It carries the microphone, a Yjs sync channel for the arrangement, and a control channel for the clock, play/stop/seek, and audio-file transfer. The mesh is capped at 4 people. Two is the comfortable size.

The shared project is a Yjs document: tracks, clips, file metadata, and the last transport command. Playback itself is scheduled locally against a measured clock, so the playhead is not written on every frame. The person with the lowest client id is the clock leader. Followers measure the offset with ping and pong. Sync is meant to land around a few tens of milliseconds, not sample accuracy.

Audio bytes are hashed with SHA-256 and kept in IndexedDB. A peer who is missing a file asks for it and receives 16 KB chunks.

## Security

The room link is the access control. Anyone who has it can join, edit, and hear the room. Details, limits, and how to report a vulnerability are in [SECURITY.md](SECURITY.md).

For a server other people can reach:

1. Terminate TLS and set `VITE_SIGNAL_URL` to the `wss://` address.
2. Set `MIXUP_ALLOWED_ORIGINS` to the site origin.
3. Set `MIXUP_TRUST_PROXY=1` only if a reverse proxy sets `X-Forwarded-For`.
4. Serve `client/dist` as static files. `npm start` runs signaling only.

## Layout

```text
client/   Vite, React, and the studio
server/   WebSocket signaling
```

The client is built to run in a normal browser. There is no desktop shell.

## License

[MIT](LICENSE)
