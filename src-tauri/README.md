# Beautiful Batches Desktop (Tauri)

This folder contains the Rust + Tauri desktop shell for Beautiful Batches.

## What changed

- The app is now wired for a desktop runtime via Tauri.
- Bulk export processing moved into a Rust command (`process_bulk_export`).
- Frontend export calls the Rust command directly.

## Run in desktop mode

From the repository root:

```bash
npm install
npm run tauri:dev
```

## Build desktop binary

From the repository root:

```bash
npm install
npm run tauri:build
```

If you want packaged installers, set `"bundle.active": true` in `src-tauri/tauri.conf.json` and provide icons.
