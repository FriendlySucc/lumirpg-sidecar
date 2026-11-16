# LumiRPG Sidecar

A background map and Ledger companion for Lumiverse roleplay chats.

## What it does

- Runs private Terra analysis after successful, non-background roleplay replies.
- Stays disabled until enabled for a chat.
- Uses a separate saved connection and never changes the roleplay model.
- Keeps one private snapshot per user and chat.
- Imports existing Local, Region, and World Atlas data as a baseline.
- Imports the Ledger only from an explicit revealed Ledger block. Dormant or unknown Ledger data stays empty.
- Validates and evidence-checks proposed map and Ledger changes before saving them.
- Marks the snapshot stale after branches, edits, deletes, swipes, restarts, or out-of-order results instead of merging incompatible state.
- Shows the map and Ledger in a drawer tab without adding messages or changing the roleplay transcript.

## Install

Place these files at the root of a trusted GitHub repository or in the server's local extension directory. Keep `spindle.json` at the repository root and keep the `src` folder beside it. Lumiverse builds the two source modules when the extension is installed; compiled output is not included.

After installation, grant `generation`, `chat_mutation`, and `chats`. Open the LumiRPG Sidecar drawer, choose a saved Terra connection, enable background updates for the current chat, and use **Analyze now** for an immediate update.

The extension can make an extra provider request after a successful assistant reply. It never edits messages, changes presets, injects its state into the roleplay prompt, or switches the main roleplay connection.

## Failure messages

Analysis errors show a fixed stage and reason code without exposing story text, model output, provider errors, credentials, or connection identifiers. Save failures distinguish changes that were not submitted, have an uncertain result, or were confirmed.

Version: 0.1.4
