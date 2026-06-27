# Repository Guidelines

## Project Structure & Module Organization
This is an Electron + React + TypeScript app. Core code lives in `src/`:

- `src/main/` for Electron main-process bootstrapping, IPC, services, and window creation.
- `src/preload/` for the bridge exposed to the renderer.
- `src/renderer/` for React UI, pages, components, layout, stores, and styles.
- `src/shared/` for shared types, IPC contracts, and utility helpers.

Build output is generated under `.vite/`. Do not edit generated files directly.

## Build, Test, and Development Commands
Use npm scripts from `package.json`:

- `npm install` installs dependencies.
- `npm run dev` starts the Electron app in development mode.
- `npm start` is the same development entry point as `dev`.
- `npm run package` creates a distributable app bundle.
- `npm run make` builds platform-specific installers.
- `npm run lint` runs TypeScript checking via `tsc --noEmit`.

## Coding Style & Naming Conventions
The project uses TypeScript and React with ES modules. Follow the existing style:

- Use 2-space indentation and semicolons, matching the current codebase.
- Name React components and files in `PascalCase` for components, `camelCase` for helpers, and `kebab-case` for non-component assets when needed.
- Keep main-process, preload, and renderer code separated by directory.
- Prefer explicit types in shared contracts and IPC payloads.

## Testing Guidelines
No automated test runner is configured yet. Before submitting changes, run `npm run lint` and manually verify the affected flow in the Electron app. If you add tests, place them near the code they cover and use a clear naming pattern such as `*.test.ts` or `*.test.tsx`.

## Commit & Pull Request Guidelines
Recent commits use short conventional-style prefixes such as `feat:` followed by a brief description. Keep commits focused and written in the imperative mood.

Pull requests should include:

- A short summary of the change and why it was made.
- Notes on verification, especially manual checks for UI or IPC changes.
- Screenshots or screen recordings for visible renderer updates.
- Links to related issues when applicable.

## Agent-Specific Instructions
Check for an existing `AGENTS.md` before creating or editing contributor guidance. Keep edits scoped to the requested task and avoid touching generated output or unrelated files.
