# LumiAtlas

A background simulation sidecar for Lumiverse roleplay chats. It keeps internal
states and a 3-layer map out of the RP model's output, so the storyteller can
focus on prose while a separately chosen model maintains continuity.

## How it works

1. After a normal assistant reply is saved, LumiAtlas makes one background call
   on your chosen connection. That call receives recent story messages plus the
   committed simulation and returns incremental state/map changes only.
2. The extension validates and applies those changes to its own per-chat record.
   Your chat messages are never rewritten.
3. Before the next RP generation, the prompt interceptor supplies the committed
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

## Permissions

- `generation` — lists saved connections and runs the separate simulation call.
- `chats` / `chat_mutation` — reads the active chat and recent visible messages.
- `interceptor` — supplies committed state to compatible RP prompts and
  compacts redundant historical state blocks before generation.

## Notes and limits

- The extension stores state per user and per chat; it does not modify the
  saved roleplay messages or the preset itself.
- Prompt offload is conservative and fingerprint-gated. Other presets continue
  to work as before, without LumiAtlas context injection.
- No live host or real-provider run is performed by the repository test suite;
  use a test chat first when updating.
