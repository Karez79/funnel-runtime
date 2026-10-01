# Decisions

Решения, которых нет в CLAUDE.md. Одна строка: решение и причина.

- TypeScript 6.0.x вместо 7.x: `typescript-eslint` 8.71 (latest и canary) требует `typescript <6.1`, а у TS 7 нет классического Compiler API, на котором держится typed linting (`strictTypeChecked`). Один компилятор на весь репозиторий, чтобы `tsc` и ESLint понимали типы одинаково.
- Сервер и скрипты исполняются Node 24 напрямую из `.ts` (встроенный type stripping), без `tsx` и без сборки сервера: меньше инструментов и нет расхождения между dev и prod. Цена: только стираемый синтаксис (`erasableSyntaxOnly`), относительные импорты с расширением `.ts`.
- `@funnel/shared` экспортирует исходники (`exports: ./src/index.ts`): его потребляют Vite, Vitest и Node с type stripping, отдельная сборка пакета не нужна.
- pnpm 11: разрешение build-скриптов через `allowBuilds` в `pnpm-workspace.yaml` (better-sqlite3, esbuild, lefthook) — замена `onlyBuiltDependencies` в этой версии pnpm.
