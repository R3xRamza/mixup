# Security

Mixup is a small shared studio, not a private account system. The room code in the link is the only thing that keeps other people out.

## What a room link allows

Anyone with the link can join that room, edit the arrangement, import audio, and hear the microphones. There are no accounts and no roles. Treat a room link like a password and send it only to the people you are working with.

New rooms use 8 characters from a 31-character alphabet (about 40 bits). Shorter codes you type yourself are easier to guess. The server accepts 4–32 characters of letters, numbers, and dashes.

## What the signaling server can see

The server introduces browsers. It stores room membership in memory and relays WebRTC offers, answers, and ICE candidates. It does not receive microphone audio, arrangement edits, or audio-file bytes. Those go peer to peer.

The handshake itself crosses the server. Put the server behind TLS (`wss://`) before anyone uses it off your own machine. The default local address is plain `ws://localhost:8787`.

WebRTC encrypts the peer connection (DTLS and SRTP). That does not hide the room code or the handshake from the signaling server.

## Limits

- 4 people in a room, 500 rooms, 20 connections from one address.
- Signaling messages are capped at 64 KB, and a connection is closed after 80 messages in 10 seconds or 5 rejected messages.
- Relayed messages must be a join or a WebRTC signal. Names are stripped of control characters.
- Each audio file is capped at 30 MB. A browser keeps at most 4 incoming transfers, 32 tracks, 400 clips, and 200 files from the shared document.
- Set `MIXUP_ALLOWED_ORIGINS` to your site when the server is public. Leave it unset for local and LAN use.
- `MIXUP_TRUST_PROXY=1` is the only case where `X-Forwarded-For` is trusted.

The production web build adds a content security policy. Dev does not, because the Vite dev server needs its own scripts. Chrome does not apply `connect-src` to STUN, so the Google STUN server still works under that policy.

## Reporting

Open a private report through GitHub security advisories on this repository: Security → Report a vulnerability. Please include the version and a short description of the impact. Do not file a public issue for an unfixed vulnerability.
