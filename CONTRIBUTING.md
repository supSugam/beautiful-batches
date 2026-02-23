# Contributing

Thanks for contributing to Beautiful Batches.

## Ground rules

- Keep PRs focused on one concern.
- Preserve existing behavior unless the change is intentional and documented.
- Prefer practical fixes over broad refactors.
- For larger changes, open an issue first and align on scope.

## Local setup

```bash
npm install
npm run tauri:dev
```

Useful commands:

```bash
npm run lint
npm run dev
npm run tauri:build
```

## Where to make changes

- UI and app behavior: `src/`
- Native scanning/export logic: `src-tauri/src/`

Key files:

- export plan UI: `src/components/modals/ExportPlanModal.tsx`
- export execution: `src-tauri/src/image_processing.rs`
- explorer tree + selection: `src/components/FolderExplorer.tsx`
- directory scanning: `src-tauri/src/scanner.rs`
- state + draft behavior: `src/store/useStore.ts`, `src/utils/editDraftPersistence.ts`

## Pull request checklist

- clear problem statement
- concise implementation notes
- screenshots or short recording for UI changes
- manual test notes (what you tested)
- linked issue (`Closes #...`) when applicable

Use the PR template: `.github/pull_request_template.md`.

## Reporting bugs

Use the issue templates in `.github/ISSUE_TEMPLATE/`.

Please include:

- OS + desktop environment
- app version / commit hash
- steps to reproduce
- expected result and actual result
- logs/screenshots/sample folder structure if relevant

## Design and UX changes

For visual or interaction updates:

- keep density and readability balanced
- avoid abrupt behavior regressions in gallery scroll, explorer selection, and inspector navigation
- include before/after capture when possible
