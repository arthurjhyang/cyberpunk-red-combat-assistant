# Cyberpunk RED Combat Assistant

A Vite + React combat settlement tool for Cyberpunk RED-style character cards.

## Features

- Start with 8 combatant slots and add more during play.
- Drag and drop `.xlsx` character cards into any roster slot.
- Pick any roster card as the attacker and any other roster card as the target.
- Read core stats, HP, armor SP, skills, and weapon rows from the supported 1.7+ card layout.
- Resolve common ranged, melee, brawling, martial arts, grapple, throw, and autofire attacks.
- After calculation, click `回填写卡` to write HP/SP changes back into the loaded workbook state.
- Click `撤回回填` to undo the latest writeback.
- Use `授权打开` before importing a card if you want `保存原卡` to overwrite the original file directly.

## Run

```bash
npm install
npm run dev
```

Open the Vite URL shown in the terminal.

## Build

```bash
npm run build
```

## Windows EXE

```bash
npm run dist:win
```

The portable executable is generated under `release/`, for example:

```text
release/Cyberpunk RED Combat Assistant-0.2.0-x64.exe
```

## Notes

Browser security only allows direct saving to the original Excel file when the card was opened through `授权打开`. Plain drag/drop or file selection can still read the card and apply in-memory writeback, but cannot silently overwrite the local file.
