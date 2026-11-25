# LumiAtlas

A background simulation sidecar for Lumiverse roleplay chats. It keeps internal
states and a 3-layer map out of the RP model's output, so the storyteller can
focus on prose while a separately chosen model maintains continuity.

## How it works

1. After a normal assistant reply is saved, LumiAtlas makes one call on the selected background connection. The first call in a chat, or an explicit Rebuild, seeds state and all three maps from the visible transcript, persona, character card and available world lore.
2. Once seeded, Analyze gets just the new user action(s), the completed reply, and a read-only JSON snapshot of the current simulation. It starts with what happened, then looks up only records that could have changed. A quiet turn can return `{"statePatch":{},"mapPatch":{}}`; a timeskip can change any number of supported entries. Analyze does not request a second triage call, an audit report, or a smaller output budget.
3. Changes are validated together before saving. Omitted fields and tiles stay put. A step within a tile changes no geometry; crossing a mapped boundary can move a named pin without regenerating either tile. The extension advances a saved numeric turn counter once. Clicking Analyze again on the same committed reply does not call the model again.
4. Before the next RP generation, the prompt interceptor supplies the committed
   state as read-only continuity context for a verified compatible Vexa preset.
   Historical Internal States blocks are compacted, and generation instructions
   for those blocks are removed from the supported preset pages. Unsupported or
   edited presets fail closed and are left completely unchanged.

This means off-screen NPC locations/agendas, memories, relationships, plot
threads and map pins can persist without the RP model rewriting the entire
simulation after every reply.

## Features

- **Internal States sidecar**: 18 state sections including world/scene,
  on-screen and off-screen characters, profiles, memories, thoughts, directional
  dynamics, relationships, reputation, inventory, leads and notes.
- **Three Map Scales**:
  - **Local**: 6-10 tile playable zones / floorplans with exits, multi-floor
    support, and fog strictly for locked/private/hidden spaces.
  - **Region**: connected places with physical size markers, terrain tiles,
    roads, and character pins.
  - **World**: bordering regions/kingdoms/districts with distinct colors,
    roads, and character pins.
- **Incremental updates**: omitted records and fields are preserved; memory is
  append-only. Existing content is never replaced by a partial model response.
- **State browser**: three dropdowns select the map or grouped state views.
  State is rendered as inert text. Ledger content appears only after an
  unambiguous `REVEALED` activation.
- **Interactive map canvas**: pan, zoom, choose current/archived zones, toggle
  pins/roads/labels, and inspect tiles, occupants and routes.
- **Live background progress**: optional reasoning and JSON streaming preview.
- **Safety**: edits, deletions, swipes, regenerations and changed replies mark
  the simulation stale rather than silently overwriting the wrong turn.
  A manual Rebuild re-simulates from the current transcript and verifies its
  source before committing.

## Setup

1. Install/update from `https://github.com/FriendlySucc/lumirpg-sidecar`.
2. Grant `generation`, `chats`, `chat_mutation`, and `interceptor` permissions.
3. Open LumiAtlas → Settings and select a background connection (for example
   Terra). This must not be a model route you want to avoid for simulation.
4. Keep "Enable for this chat" and "Auto-update after replies" enabled, then
   send a normal RP reply or click Analyze.

For the best offload behavior, use the currently supported Vexa Beta v3 preset
without modifying its Internal States, Atlas, GM Notebook, Router, or
Tail/Output blocks. If the fingerprint checks do not recognize the preset,
LumiAtlas still maintains its own state but leaves the RP prompt untouched.

## Updating from 0.4.x

Use **Extensions → LumiAtlas → Update**. No rebuild or field conversion is needed for a valid saved chat. v0.5 reads the old per-chat record and writes structured JSON to `lumi-atlas-v2/chats/` on the next successful save; read-only opens do not migrate or modify the original. It keeps the v1 checkpoint and connection settings. Rolling back to 0.4.x resumes that checkpoint, not subsequent v2 changes. Back up per-user extension storage before a downgrade; if you play more turns on an older version, Rebuild after re-upgrading to reconcile the transcript.

The ready message reports elapsed time and JSON output length. Compare ordinary turns with ordinary turns on the same connection and reasoning setting; a full initial build is not a useful latency baseline.

## Permissions

- `generation` — lists saved connections and runs the separate simulation call.
- `chats` / `chat_mutation` — reads the active chat and recent visible messages.
- `characters`, `personas`, `world_books` — optional reference reads for first-time setup and Rebuild, not routine Analyze.
- `interceptor` — supplies committed state to compatible RP prompts and
  compacts redundant historical state blocks before generation.

## Notes and limits

- The extension stores state per user and per chat; it does not modify the
  saved roleplay messages or the preset itself.
- Prompt offload is conservative and fingerprint-gated. Other presets continue
  to work as before, without LumiAtlas context injection.
- No live host or real-provider run is performed by the repository test suite;
  use a test chat first when updating.
