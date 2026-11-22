# LumiAtlas

A map-first, background 3-layer Atlas extension for Lumiverse roleplay chats.

## Features

- **Three Map Scales**:
  - **Local**: Game-ready 6-10 tile playable zones / floorplans with cardinal exits, multi-floor support, and fog strictly for locked/private/hidden spaces.
  - **Region**: 8-12 connected places with physical size markers (m / km), shared borders, terrain tiles, roads, and character pins.
  - **World**: 6-10 bordering regions/kingdoms/districts with distinct per-region colors, terrain tiles filling gaps, roads, and character pins.
- **Zone Initialization Protocol**: Entering a new house, district, or hub fleshes out the full playable neighborhood upfront.
- **Separate Background Connection**: Runs on a user-selected connection (e.g. Terra) after assistant replies without touching your main RP model, preset, or chat transcript.
- **Interactive Cartographic Canvas**: Pan, zoom, fit-to-view, toggle pins/roads, and click any tile to inspect features, occupants, and connected neighbors.

## Permissions

- `generation` — to list saved connections and run background map updates on the chosen connection.
- `chats` — to read the active chat and recent visible messages.
