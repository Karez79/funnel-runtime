# Decisions

Решения, которых нет в CLAUDE.md. Одна строка: решение и причина.

- TypeScript 6.0.x вместо 7.x: `typescript-eslint` 8.71 (latest и canary) требует `typescript <6.1`, а у TS 7 нет классического Compiler API, на котором держится typed linting (`strictTypeChecked`). Один компилятор на весь репозиторий, чтобы `tsc` и ESLint понимали типы одинаково.
- Сервер и скрипты исполняются Node 24 напрямую из `.ts` (встроенный type stripping), без `tsx` и без сборки сервера: меньше инструментов и нет расхождения между dev и prod. Цена: только стираемый синтаксис (`erasableSyntaxOnly`), относительные импорты с расширением `.ts`.
- `@funnel/shared` экспортирует исходники (`exports: ./src/index.ts`): его потребляют Vite, Vitest и Node с type stripping, отдельная сборка пакета не нужна.
- pnpm 11: разрешение build-скриптов через `allowBuilds` в `pnpm-workspace.yaml` (better-sqlite3, esbuild, lefthook) — замена `onlyBuiltDependencies` в этой версии pnpm.
- Корневой `vitest.config.ts` с `test.projects` вместо `vitest.workspace.ts`: workspace-файл в Vitest 4+ удалён, `projects` — его замена; пороги покрытия заданы по glob на пакет.
- Зависимости добавляются в той же задаче, что и код, который их использует: `knip` падает на неиспользуемых зависимостях, так что заранее установленный «набор на будущее» ломал бы ворота.
- Stylelint `declaration-strict-value`: функции (`color-mix()`, `linear-gradient()`) разрешены, но сырые литералы цветов, радиусов, теней и шрифтов вне `tokens.css` запрещены.
- Сырые цвета запрещены Stylelint в любом свойстве и внутри любой функции (`color-no-hex`, `color-named`, `function-disallowed-list` для rgb/hsl/oklch/…); `color-mix()` и градиенты разрешены, но только поверх `var(--…)`. Шорткат `font` запрещён вне `tokens.css`, чтобы `font-family` всегда проверялся.
- `apps/server/src/main.ts` исключён из покрытия: это только склейка процесса (env → БД → listen → сигналы), его поведение проверяют e2e и healthcheck на Railway.
- `lint:deps` охватывает `scripts/` и `e2e/` с той задачи, где эти папки появляются (depcruise падает на несуществующем пути).
- Stylelint `lightness-notation`, `hue-degree-notation` и `alpha-value-notation` выключены (и `custom-property-empty-line-before`, чтобы группировать токены): токены OKLCH переносятся из эталона один в один (`oklch(0.925 0.014 258)`), а не переписываются в проценты и градусы.
- `tokens.css` = `:root` эталона один в один плюс три осознанных отличия: в `--font` первым стоит `'Plus Jakarta Sans Variable'` (имя семейства в npm-пакете fontsource), добавлены `--on-ink` (текст на чёрном, вместо `#fff` в эталоне) и `--focus-ring` (цвет фокуса, в эталоне был инлайн `color-mix`).
- Страница `/admin/*` (SPA) пока отдаётся без Basic Auth, защищены только админские API. В Фазе 5 решить: guard на страницу или явная запись почему нет (данных страница без API не содержит).
- Контейнер работает от root: Railway монтирует volume с владельцем root, отдельный пользователь потребовал бы chown при каждом старте. `RAILWAY_RUN_UID=0` задан явно как страховка (§2).
- Проверка прода после деплоя — отдельный workflow `verify-deploy.yml` на событии `deployment_status` (Railway создаёт GitHub deployment `funnel-runtime / production`), а не job в `ci.yml`: Railway «Wait for CI» ждёт workflow, запущенные push в ветку, и проверка прода внутри push-CI заблокировала бы деплой навсегда.
- Stop-хук пропускает `pnpm check`, если отпечаток дерева (HEAD + `git diff HEAD` + неотслеживаемые файлы с содержимым) совпадает с последним зелёным прогоном. Строгость та же: любое изменение байта запускает полную проверку.
- Счётчики находок ревьюера берутся из комментариев PR скриптом `pnpm review:stats`. Последняя строка комментария ревьюера считает только новые находки раунда. Комментарий раунда 2 у #18 (до этого правила) включал 2 открытые находки в счёт, поэтому minors у #18 завышены на 2 (скрипт даёт 12, новых было 10).
