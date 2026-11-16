# LumiRPG Sidecar — prototype source

This is a source prototype for a Lumiverse 1.3.0 Spindle extension. It has not been built or installed in this workspace because no Bun/TypeScript runner is exposed here. Treat it as unverified until the host builds it and the user tests it in a disposable chat.

## Design

- Background-only Terra analysis after successful, non-background roleplay replies.
- Per-chat opt-in; disabled by default.
- Separate saved connection selected in the drawer; it never switches the roleplay model.
- Private per-user storage; no tracker messages, prompt injection, preset edits, or transcript edits.
- Existing `<state:locations>` Atlas data is imported as a baseline for Local / Region / World maps. Rendered rooms are usable; `loc_load` details remain hidden.
- The standalone Ledger lifecycle is imported only from an explicit `<details class="ldg-source">` block. Dormant/unknown Ledger status is never turned into stats or skills.
- Terra responses are JSON-only, bounded, validated, evidence-checked, and rejected without replacing the previous snapshot when invalid.
- Branches, edits, deletes, swipes, restarts, and out-of-order results mark the snapshot stale instead of silently merging incompatible state. Rebuild is explicit.
- The drawer contains an SVG map with proportional tiles and clipped connection lines, plus Ledger sections for stats, skills, equipment, quests, flags, and recent changes.

## Installation

This repository needs to live in a trusted GitHub repository or the server's local extension directory before Spindle can install it. Replace the placeholder `github` and `homepage` fields in `spindle.json` before publishing. The empty `dist/` directory was intentionally removed so Lumiverse can auto-build `src/backend.ts` and `src/frontend.ts` on install, as documented by Lumiverse.

After installation, grant `generation`, `chat_mutation`, and `chats`. `chat_mutation` is read-only here: it is required by Lumiverse for bounded message reads, but this prototype never edits messages. Open the drawer tab, choose a saved Terra connection, enable background updates for the current chat, and use **Analyze now**. Extra provider usage can occur whenever a successful assistant reply is analyzed.

## Current limitation

The source includes synthetic Bun tests in `tests/sidecar.test.ts`, but no build, type-check, or test has been run in this workspace because no Bun runner is exposed here. Run `bun install`, `bun test tests/sidecar.test.ts`, and `bun run build` in the host or a trusted clone before installation. This archive remains a source prototype, not a finished extension release.
