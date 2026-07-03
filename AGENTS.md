# Repository Guidelines

## What This App Is

- Electron Forge + Vite desktop app: main process owns runtime, filesystem, SQLite, model/tool calls; renderer owns React UI and Zustand state.
- Real entrypoints are `src/main/index.ts`, `src/preload/index.ts`, and `src/renderer/main.tsx`; Forge wires them through `forge.config.ts` and `vite.*.config.ts`.

## Commands

- `npm install` installs dependencies from `package-lock.json`.
- `npm run dev` / `npm start` launches the Electron app through Electron Forge.
- `npm run lint` is TypeScript only: `tsc --noEmit`. Do not run it automatically if the user asks to skip local checks.
- `npm run package` and `npm run make` create distributables; do not run packaging builds unless explicitly requested.
- Test files exist and `tsconfig.test.json` can compile them to `.tmp-tests`, but `package.json` currently has no test script.

## Cross-Process Changes

- Renderer code must call main-process capabilities through `window.anybuddy`; do not import Electron or Node APIs in `src/renderer/`.
- For new or changed IPC, update all four places together: `src/shared/ipc.ts`, `src/preload/bridge.ts`, `src/main/ipc/register-ipc-handlers.ts`, and `src/renderer/api/clients.ts`.
- Shared payload and domain types live in `src/shared/types.ts`; keep IPC contracts explicit there before wiring UI or services.

## Runtime And Persistence Gotchas

- SQLite persistence is in `src/main/repositories/app-state-repository.ts`; `save(state)` rewrites all tables inside one transaction. Avoid calling persistent mutations for high-frequency stream chunks.
- Agent runtime is coordinated by `src/main/services/agent-runtime-service.ts`; DeepAgents execution is in `src/main/services/deepagent-executor.ts`; project tools are registered in `src/main/services/tool-registry-service.ts`.
- Streaming assistant output should stay transient until a run completes; final assistant messages are persisted via `completeRuntimeRun` in `AppService`.
- Runtime patches reach the renderer through `agent-run:task-changed:<taskId>` and are merged in `src/renderer/stores/app-store.ts`; avoid rebuilding `messages` for every streaming token.
- Skills are global user folders under `~/.anybuddy/skills/<skillId>/SKILL.md`; DeepAgents mirrors selected skills into the current backend's `.system-skill-cache` before execution.

## Local Data And Config

- Main state is stored in `anybuddy.db` under Electron `app.getPath('userData')`, not in the repo.
- Model and MCP config are mirrored through files under `~/.anybuddy` via `AppService`; access them through main-process service APIs.
- Generated build output under `.vite/` and `dist/renderer/` should not be edited directly.

## UI Notes

- The renderer uses React 19, Ant Design, lucide icons, and Zustand.
- Task conversation UI is centered in `src/renderer/pages/TaskDetailPage.tsx`; runtime message shaping lives in `src/renderer/stores/runtime-message-view.ts`.
- Preserve the existing auto-scroll behavior: follow new output only when the user is already near the bottom or after switching tasks.
