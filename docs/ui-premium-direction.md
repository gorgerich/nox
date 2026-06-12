# Nox UI Premium Direction

## Product Register

Nox is a private messenger. Design serves fast daily communication, not decoration.

Scene: user opens Nox on a phone in mixed light, moves between chats, calls, search, and profile many times per day. UI must feel quiet, fluid, secure, and immediate.

## Principles

- Minimal visible chrome. Let messages, people, and actions lead.
- Liquid glass only where it helps hierarchy: dock, sheets, composer, headers.
- No noisy shadows between rows. Use hairlines, tint, and soft depth.
- Motion must show state: press, reveal, send, open sheet, active tab.
- Default interactions must feel tactile: spring press, specular sweep, subtle lift.
- Copy stays Russian, short, normal case.

## Implementation Notes

- Shared primitives live in `src/app/globals.css`.
- Prefer CSS GPU transforms over JS animation loops.
- Keep WebRTC and message logic untouched during UI passes.
- After good build: commit and push `main`.
