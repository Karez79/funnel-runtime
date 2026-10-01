# Funnel Runtime — спецификация проекта для Claude Code

Этот файл — единственный источник правды по проекту. Прочитай его целиком перед любой работой и перечитывай раздел текущей фазы перед её началом. Если в процессе приходится принять решение, которого здесь нет, прими самое простое разумное, запиши его в `docs/DECISIONS.md` (одна строка: решение и причина) и продолжай.

Контекст: это тестовое задание на позицию fullstack-разработчика, срок 48 часов, времени уже меньше. Проверяющие оценивают: работоспособность и отсутствие регрессий (25%), версии и rollback (20%), события и аналитику (20%), продуктовые решения (20%), агентский процесс (15%). Приоритет всегда такой: **корректность инвариантов > работающий публичный URL > полнота фич > красота**. Никогда не жертвуй тестами инвариантов ради фич.

---

## 1. Что строим, одним абзацем

Мини-платформа для многошаговых веб-квизов («воронок»). Воронка целиком описана JSON-конфигом, фронтенд ничего не знает о конкретных экранах и рисует их по конфигу. Бэкенд хранит версии конфига, публикует и откатывает их без передеплоя, закрепляет версию и A/B-вариант за сессией пользователя, принимает события пачками с дедупликацией, а внутренний дашборд считает воронку по уникальным сессиям. Генератор синтетического трафика наполняет базу проверяемыми данными и сам знает «правильный ответ», с которым сверяется дашборд.

Конфиги лежат в `configs/`: `funnel-v1.json`, `funnel-v2.json`, `funnel-v3.json`. **v1 и v2 — первая итерация** (в задании это «два локальных конфига»): seed публикует v1 и загружает v2 черновиком, а публикация v2 демонстрирует версионирование. **v3 — вторая итерация** («новый конфиг после первой версии»): его нельзя сидить, публиковать и подстраивать под него код до Фазы 7. В Фазе 7 v3 загружается **через админку или API** (`POST /api/admin/versions`) на уже работающий прод, без передеплоя — это и есть демонстрация «публикации новой версии без передеплоя». Движок при этом должен быть общим и поддерживать все операторы условий заранее (см. 4.2), это нормальная инженерная предусмотрительность, а не подгонка.

---

## 2. Стек (не менять без записи в DECISIONS.md)

Правило версий: все зависимости ставятся как `pnpm add <pkg>@latest` на момент установки, мажорные версии фиксируются в lock-файле. Не опираться на версии «по памяти»: если API пакета изменился, смотри его актуальную документацию (README в `node_modules` или официальный сайт), а не старые примеры.

- **Монорепо:** pnpm workspaces, `packageManager` зафиксирован в корневом `package.json`, `engines.node` — текущий Active LTS (на момент написания Node 24). Общий `tsconfig.base.json` со `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `verbatimModuleSyntax`; пакеты — ESM.
- **packages/shared:** чистый TypeScript без зависимостей от Node и DOM, кроме `zod` (v4). Единственный источник правды для всего, что используют и клиент, и сервер (см. 3.1).
- **apps/server:** Fastify 5 + `fastify-type-provider-zod` (валидация и типы маршрутов из тех же zod-схем, что использует клиент), **Drizzle ORM** поверх `better-sqlite3` (схема таблиц в TypeScript, SQL-миграции генерирует `drizzle-kit`, типы строк выводятся из схемы), `pino`. Сервер в проде раздаёт и API, и собранный фронтенд (`@fastify/static`): один процесс, один URL.
- **apps/web:** React 19 с **React Compiler** (ручные `useMemo`/`useCallback`/`memo` не пишем, мемоизацию делает компилятор), Vite, React Router (data-режим), TanStack Query для серверного состояния. Стили: CSS-переменные из `tokens.css` + CSS Modules. Без UI-китов и без библиотек графиков: всё на наших UI-примитивах, CSS и SVG.
- **Тесты:** Vitest во всех пакетах (workspace-конфиг в корне), покрытие v8 с порогами (3.1). Серверные тесты через `fastify.inject()` на временной SQLite. **Playwright e2e обязателен** (smoke-набор, раздел 12): человек не проверяет руками, поэтому регрессии ловит автоматика.
- **Качество (автоматические ворота, см. 3.1):** ESLint flat config с `typescript-eslint` (strictTypeChecked), Prettier, Stylelint, `dependency-cruiser` (границы модулей), `knip` (неиспользуемые файлы, экспорты, зависимости), `jscpd` (копипаста). Git-хуки через `lefthook`. CI — GitHub Actions.
- **Скрипты:** `tsx`.
- **ID:** `uuid` v7 (сортируемые по времени) для `session_id` и `event_id`; события получают id на клиенте, сессии — на сервере.
- **Деплой:** Railway (пробный тариф), `Dockerfile` (multi-stage на образе текущего Node LTS, slim) + `railway.json` с healthcheck на `/api/health`. SQLite лежит на Railway volume, смонтированном в `/data` (`DATABASE_PATH=/data/funnel.db`). Сервер слушает `0.0.0.0:$PORT`. Volume подключается только в рантайме, поэтому миграции и seed выполняются при старте сервера, а не при сборке. Если запись в volume падает по правам — переменная `RAILWAY_RUN_UID=0`. Один инстанс (реплики с volume недоступны, и SQLite это и нужно). Сторонних сервисов (аналитика, внешняя БД, очереди, CDN шрифтов) нет и не будет.
- **Шрифт:** Plus Jakarta Sans из npm-пакета `@fontsource-variable/plus-jakarta-sans`, бандлится в сборку. **Не подключать Google Fonts**: это внешний сервис, задание их запрещает. `<link>` на Google Fonts в `reference.html` есть только для удобства просмотра эталона.

### 2.1. Инструменты разработки: MCP-серверы

MCP-серверы — инструменты **разработки**, а не часть приложения: собранное приложение не обращается ни к одному внешнему сервису, так что требование задания «никаких сторонних сервисов» не нарушается. В начале работы выполни `claude mcp list` (или `/mcp`) и используй то, что подключено:

- **GitHub MCP** — всё, что связано с репозиторием: milestones, issues, ветки, pull request'ы, ревью-комментарии, статусы CI, слияние (процесс в 13.1). Если какой-то операции в MCP нет (например, правила защиты ветки), используй `gh` CLI, а если и его нет — попроси человека и дай точную инструкцию.
- **Railway** (официальный плагин Claude Code или hosted MCP `mcp.railway.com`) — создание проекта и сервиса из GitHub-репозитория, volume, переменные окружения, публичный домен, деплой-логи, статус деплоя. Человек только проходит авторизацию. Если инструмента для операции нет — Railway CLI, затем просьба к человеку.
- **Playwright MCP** (если подключён) — открыть приложение в браузере, сравнить экраны с `docs/design/reference.html`, проверить проблему, которую описал человек. Автотесты всё равно пишутся на `@playwright/test` и живут в репозитории.
- **Context7** (если подключён) — актуальная документация библиотек перед использованием их API (правило версий выше).

- **Chrome DevTools MCP** (если подключён) — ошибки в консоли, сетевые запросы, производительность страницы (Lighthouse-метрики) на проде после каждой фазы.
- **AccessLint** (если подключён) — аудит доступности экранов воронки и админки в Фазе 8 вместе с `@axe-core/playwright`.

**Не использовать в этом проекте:** shadcn MCP (у нас свои UI-примитивы и эталон дизайна, UI-киты запрещены разделом 2), генераторы изображений и видео, дизайн-коннекторы (Figma, Notion, Linear и т. п.). Если человек их не отключил, просто не вызывай их инструменты.

Не подключённый сервер не блокирует работу: используй CLI-эквивалент или попроси человека.

Корневые команды в `package.json`:

```
pnpm dev            # сервер + веб в watch-режиме (concurrently)
pnpm build          # сборка всего
pnpm start          # прод-запуск собранного сервера
pnpm test           # все unit- и интеграционные тесты с порогами покрытия
pnpm e2e            # Playwright smoke-набор против собранного приложения
pnpm typecheck
pnpm lint           # ESLint + Stylelint + dependency-cruiser + knip + jscpd
pnpm check          # typecheck + lint + test + build — единые ворота качества (их же гоняет CI и Stop-хук)
pnpm db:generate    # drizzle-kit: SQL-миграция из изменений схемы
pnpm screenshots    # Playwright: скриншоты и GIF для README в docs/images/
pnpm seed           # импорт configs/funnel-v1.json (published, активна) и configs/funnel-v2.json (draft). v3 НЕ сидится.
                    # Та же функция вызывается при старте сервера, если таблица funnel_versions пуста.
pnpm generate       # генератор трафика (см. раздел 9)
pnpm verify         # сверка API аналитики с ground truth генератора
pnpm demo:iteration2  # сценарий второй итерации (раздел 13, Фаза 7)
```

---

## 3. Структура репозитория

```
funnel-runtime/
  CLAUDE.md  README.md
  .claude/agents/reviewer.md      субагент-ревьюер (см. 14)
  .claude/settings.json           хуки Claude Code (см. 14)
  .github/workflows/ci.yml        pnpm check + pnpm e2e на каждый PR и push в main
  .github/pull_request_template.md
  lefthook.yml  .dependency-cruiser.cjs  knip.json  .jscpd.json  eslint.config.js  stylelint.config.js
  tsconfig.base.json  vitest.workspace.ts  playwright.config.ts
  configs/                        funnel-v1.json, funnel-v2.json, funnel-v3.json
  docs/
    images/                       скриншоты и GIF для README (pnpm screenshots)
    ARCHITECTURE.md  EXPLAIN.md   DATA_MODEL.md  EVENTS.md  ANALYTICS.md  EXPERIMENT.md
    TIMELINE.md  AGENT_LOG.md  DECISIONS.md  LIMITATIONS.md  REQUIREMENTS.md
    design/reference.html         визуальный эталон, см. раздел 10
  packages/shared/src/
    config/      schema.ts lint.ts diff.ts
    engine/      conditions.ts resolve.ts navigation.ts validation.ts result.ts
    events/      schema.ts catalog.ts answerKind.ts
    analytics/   aggregate.ts stats.ts
    api/         contract.ts errors.ts      контракт HTTP API: маршруты, схемы запросов и ответов, коды ошибок
    index.ts                                 публичный вход пакета; всё остальное внутреннее
  apps/server/src/
    main.ts  app.ts  env.ts                  env.ts — единственное место чтения process.env (zod)
    db/          schema.ts client.ts migrate.ts seed.ts
    drizzle/     *.sql                       сгенерированные миграции, коммитятся
    modules/
      versions/  routes.ts service.ts repo.ts
      sessions/  routes.ts service.ts repo.ts assignment.ts
      events/    routes.ts service.ts repo.ts
      analytics/ routes.ts service.ts repo.ts
      live/      routes.ts bus.ts
      health/    routes.ts
    plugins/     auth.ts security.ts errors.ts sse.ts
  apps/web/src/
    main.tsx  router.tsx
    design/      tokens.css global.css fonts.ts
    lib/         api.ts                       типизированный клиент из packages/shared/api/contract.ts
                 viewTransition.ts  storage.ts
    ui/          Button IconButton Pill Chip Panel Card Ring HalfDonut Bars Sparkline Table
                 Dialog CommandPalette Toast Popover SegmentedControl Notch  (+ *.module.css)
    features/
      funnel/    FunnelPage useFunnelSession funnelReducer eventQueue steps/ PreviewBanner DebugOverlay ResultWeek
      admin-shell/  AdminLayout TopNav Rail
      versions/  VersionsPage DiffPanel ActivationHistory
      dashboard/ DashboardPage KpiCards JourneyMap JourneyLinks StepPopover JourneyTable AbPanel DataQuality VersionsCompared OtherEvents
      live/      LiveEventsPage
  scripts/       generate-traffic.ts verify.ts demo-iteration2.ts screenshots.ts
  e2e/           funnel.spec.ts admin.spec.ts
  Dockerfile  railway.json  .env.example
```

### 3.1. Архитектура и правила кода

Цель: каждое правило и каждый контракт описаны **ровно в одном месте**, остальной код их импортирует. Человек код не проверяет, поэтому правила ниже закреплены автоматическими проверками, а не только текстом.

**Единые источники правды**

| Что | Где живёт | Кто использует |
|---|---|---|
| Формат конфига воронки | `shared/config/schema.ts` (zod) | сервер (загрузка, линт), клиент (типы), генератор |
| Логика воронки (видимость, путь, прогресс, валидация, результат) | `shared/engine/*` | сервер (валидация состояния, результат), клиент (рендер), генератор (прохождение веток) |
| Схема события и каталог | `shared/events/*` | ingest, клиентская очередь, генератор |
| Расчёт метрик и статистика | `shared/analytics/*` | API аналитики, `verify`, тесты |
| HTTP-контракт: пути, методы, схемы тела и ответа, коды ошибок | `shared/api/contract.ts`, `errors.ts` | сервер регистрирует маршруты из контракта через `fastify-type-provider-zod`; клиент `lib/api.ts` и генератор вызывают API через тот же контракт |
| Схема БД | `server/db/schema.ts` (Drizzle) | репозитории; SQL-миграции генерируются, руками не пишутся |
| Переменные окружения | `server/env.ts` (zod) | весь сервер |
| Дизайн-токены | `web/design/tokens.css` | все стили; сырых цветов, радиусов и теней в компонентах нет |
| UI-примитивы | `web/ui/*` | все экраны; экран не стилизует кнопку, пилюлю или панель сам |

Следствия: типы не объявляются вручную, если их можно вывести (`z.infer`, `typeof table.$inferSelect`); генератор и `verify` не дублируют логику, а импортируют движок и агрегатор; ground truth генератора считается **той же** функцией `aggregate`, но по его собственному журналу намерений, а не по данным сервера, иначе сверка была бы тавтологией.

**Слои и границы (проверяет `dependency-cruiser`, нарушение роняет `pnpm lint`)**
- `packages/shared` не импортирует ничего из `apps/*`, Node API и DOM.
- `apps/web` и `apps/server` не импортируют друг друга; общее — только через `@funnel/shared`.
- Сервер: `routes → service → repo → db`. Маршрут не ходит в БД, репозиторий не знает про HTTP, бизнес-правила только в `service` и `shared`.
- Веб: `features/*` используют `ui/*` и `lib/*`, но не импортируют внутренности других фич. `ui/*` не знает о фичах и API.
- Импорт из пакета только через его `index.ts`, глубокие пути запрещены.

**Правила кода**
- Нет `any`, нет `as` для обхода типов (кроме сужения после проверки), нет `!` non-null assertion. Ошибки домена — типизированные (`shared/api/errors.ts`), сервер превращает их в HTTP через один плагин `plugins/errors.ts`.
- Функции движка и агрегатора чистые: без времени, случайности и ввода-вывода внутри; время и seed передаются параметрами.
- Состояние воронки на клиенте — `useReducer` с чистым `funnelReducer`, который вызывает функции движка. Серверное состояние — только через TanStack Query. Глобальных сторов нет.
- Один стиль ошибок, логов и ответов API во всех модулях; никаких `console.log` в коммитах (ESLint).
- Комментарий «почему так» в шапке каждого нетривиального модуля; комментарии «что делает строка» не нужны.

**Автоматические ворота качества (`pnpm check`, CI, Stop-хук)**
- `tsc --noEmit` по всем пакетам, ESLint strictTypeChecked с нулём предупреждений, Prettier.
- Stylelint: цвета, радиусы, тени и шрифты только через `var(--…)` (`stylelint-declaration-strict-value`), кроме `tokens.css`.
- `dependency-cruiser`: правила границ выше.
- `knip`: ни одного неиспользуемого файла, экспорта или зависимости.
- `jscpd`: дублирование кода не выше 2% (минимум 40 токенов), тесты и сгенерированные миграции исключены. Если порог превышен — выносить общее в `shared` или `ui`, а не поднимать порог.
- Покрытие: `packages/shared` ≥ 90% строк, `apps/server` ≥ 80%; `apps/web` покрывается e2e.
- `pnpm build` проходит без предупреждений.

## 4. Конфиг и движок воронки (packages/shared)

### 4.1. Формат конфига

Смотри `configs/funnel-v1.json`. Ключевое:

- `steps` — словарь шагов по id. Типы: `info`, `single-select`, `multi-select`, `number`, `result`.
- `experiment.variants.{A,B}.stepSequence` — порядок шагов для варианта. Последний шаг всегда `result`.
- `stepOverrides` — глубокий merge поверх шага (обычно `content`). `resultOverrides` — merge поверх `results[resultId]`.
- Ответы хранятся по ключу `input.name` (в данных конфигах он совпадает с id шага); условия `visibleWhen` и `resultRules` ссылаются на этот ключ.
- `visibleWhen` у шага — условие показа. Шаг без `visibleWhen` виден всегда.
- `resultRules` — упорядоченный список, побеждает первое сработавшее правило, иначе `defaultResultId`.
- `events.allowed` — **каталог событий этой версии**. В v3 добавляется `recommendation_expanded`. Каталог читается из конфига, а не захардкожен.
- `events.privacy.storeRawAnswers = false` — сырые ответы в события не попадают никогда.
- Поле `status` внутри JSON игнорируется как источник правды: статус версии хранится в БД.
- `experiment.id` меняется от версии к версии (`...-v1`, `...-v2`, `...-v3`). Значит, A/B сравнивается только внутри одной версии.

zod-схема должна быть строгой к известным полям и терпимой к неизвестным (`.passthrough()` на верхнем уровне), чтобы будущие поля не ломали загрузку старых версий.

### 4.2. Условия (`engine/conditions.ts`)

Узел условия — это одно из:

- лист `{ answer, operator, value }`;
- `{ all: Condition[] }`, `{ any: Condition[] }`, `{ not: Condition }`.

Операторы: `eq`, `ne`, `in`, `not_in`, `gt`, `gte`, `lt`, `lte`, `contains` (для массивов multi-select), `exists`. Если ответа нет или он относится к скрытому шагу, лист возвращает `false` (кроме `not` поверх него). Неизвестный оператор — ошибка валидации конфига при публикации, а в рантайме — `false` плюс warning в лог.

### 4.3. Применение варианта (`engine/resolve.ts`)

`resolveFunnel(config, variant) → ResolvedFunnel { sequence, steps, results, eventCatalog, meta }`. Чистая функция, используется и сервером, и клиентом. Клиент получает уже резолвнутый конфиг для своего варианта, второй вариант ему не отдаётся.

### 4.4. Навигация (`engine/navigation.ts`)

- `visiblePath(resolved, answers)` — шаги из `sequence`, у которых `visibleWhen` истинно при текущих ответах. Вычисляется заново после каждого ответа, потому что ответ может открыть или скрыть последующие шаги.
- `nextStep(resolved, answers, currentId)` — следующий шаг в `visiblePath` после текущего.
- Назад: по стеку истории `history: string[]`, а не по `visiblePath`. Это защищает от ситуации, когда пользователь изменил ответ и путь перестроился.
- `progress(resolved, answers, currentId) → { index, total }` — считаем только видимые шаги, исключая типы из `progress.excludeTypes` (`info`, `result`). Total пересчитывается при изменении ответов (выбрал «remote» — шагов стало меньше, это ожидаемо).
- Ответы на шаги, ставшие скрытыми, **не удаляются** из состояния (вдруг пользователь вернёт старый ответ), но **игнорируются** при вычислении результата и при валидации завершённости. Функция `effectiveAnswers(resolved, answers)` возвращает только ответы видимых шагов.

### 4.5. Валидация (`engine/validation.ts`)

`validateAnswer(step, value) → { ok: true } | { ok: false, code, message }`. Коды: `required`, `min`, `max`, `minSelections`, `maxSelections`, `integer`, `invalidOption`. Сообщения берутся из `step.validation.messages`, при отсутствии используются дефолтные английские. Числа: целые, если `input.step === 1`. Значение опции должно существовать в `input.options`.

### 4.6. Результат (`engine/result.ts`)

`computeResult(resolved, answers) → resultId` по `effectiveAnswers`. Сервер — источник правды для результата (см. 6.3). Клиент использует ту же функцию только для оптимистичного рендера.

### 4.7. Линт и diff (`config/lint.ts`, `config/diff.ts`)

`lintConfig(config) → { errors[], warnings[] }`. Ошибки блокируют публикацию:

- каждый id в `stepSequence` существует в `steps`; `result` последний и единственный типа `result`;
- `visibleWhen` ссылается только на ответы шагов, которые **в каждом варианте стоят раньше** этого шага (иначе условие недостижимо или зависит от будущего);
- `resultRules[].resultId` и `defaultResultId` существуют в `results`;
- ключи `stepOverrides`/`resultOverrides` существуют;
- все операторы известны; веса вариантов > 0;
- `funnelId` совпадает с существующими версиями; `version` больше всех существующих;
- каталог событий содержит 7 базовых событий;
- `schemaVersion` с известной мажорной версией (`1.x`); неизвестная мажорная — ошибка, чтобы старый движок не исполнял несовместимый конфиг.

Предупреждения (не блокируют): шаг удалён из варианта, добавлен новый результат, добавлено новое событие и т. п.

`diffConfigs(a, b)` → человекочитаемый список изменений: добавленные/удалённые шаги по вариантам, новые/удалённые результаты и правила, новые события, изменённые тексты. Показывается в админке перед публикацией.

---

## 5. Модель данных (SQLite)

Схема описывается в `apps/server/src/db/schema.ts` (Drizzle). SQL-миграции генерирует `pnpm db:generate` в `apps/server/drizzle/`, они коммитятся и применяются автоматически при старте сервера мигратором Drizzle (учёт применённых в его служебной таблице). **Ручных изменений схемы нет никогда.** SQL ниже — эталон того, что должна дать схема Drizzle (таблицы, ограничения, индексы); писать его руками не нужно. Вторая итерация не должна требовать новой миграции: всё, что зависит от конфига (каталог событий, свойства), хранится в JSON-колонках. Это проверяется тестом (раздел 12).

Включить `PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;`.

```sql
CREATE TABLE funnel_versions (
  funnel_id      TEXT NOT NULL,
  version        INTEGER NOT NULL,
  config_json    TEXT NOT NULL,           -- исходный конфиг как есть
  config_hash    TEXT NOT NULL,           -- sha256, для идемпотентной загрузки
  release_note   TEXT,
  state          TEXT NOT NULL CHECK (state IN ('draft','published')),
  created_at     TEXT NOT NULL,
  PRIMARY KEY (funnel_id, version)
);

-- Журнал активаций, только append. Активная версия = последняя строка.
CREATE TABLE funnel_activations (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  funnel_id      TEXT NOT NULL,
  version        INTEGER NOT NULL,
  action         TEXT NOT NULL CHECK (action IN ('publish','rollback','activate')),
  from_version   INTEGER,
  note           TEXT,
  created_at     TEXT NOT NULL,
  FOREIGN KEY (funnel_id, version) REFERENCES funnel_versions(funnel_id, version)
);

CREATE TABLE sessions (
  id              TEXT PRIMARY KEY,         -- uuid v7
  funnel_id       TEXT NOT NULL,
  funnel_version  INTEGER NOT NULL,         -- закреплено навсегда
  experiment_id   TEXT NOT NULL,
  variant         TEXT NOT NULL CHECK (variant IN ('A','B')),
  variant_source  TEXT NOT NULL CHECK (variant_source IN ('hash','override')),
  traffic_type    TEXT NOT NULL DEFAULT 'live' CHECK (traffic_type IN ('live','qa','synthetic')),
  utm_source      TEXT, utm_medium TEXT, utm_campaign TEXT, utm_content TEXT, utm_term TEXT,
  state_json      TEXT NOT NULL,            -- {answers, history, currentStepId}
  state_rev       INTEGER NOT NULL DEFAULT 0,
  result_id       TEXT,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  expires_at      TEXT NOT NULL,
  FOREIGN KEY (funnel_id, funnel_version) REFERENCES funnel_versions(funnel_id, version)
);
CREATE INDEX sessions_version_idx ON sessions(funnel_id, funnel_version, variant);

CREATE TABLE events (
  event_id        TEXT PRIMARY KEY,          -- дедупликация на уровне PK
  session_id      TEXT NOT NULL,
  name            TEXT NOT NULL,
  funnel_id       TEXT NOT NULL,
  funnel_version  INTEGER NOT NULL,          -- берётся из сессии, не от клиента
  experiment_id   TEXT NOT NULL,
  variant         TEXT NOT NULL,
  step_id         TEXT,
  utm_source TEXT, utm_medium TEXT, utm_campaign TEXT,
  client_ts       TEXT,                      -- как прислал клиент
  server_ts       TEXT NOT NULL,             -- время приёма
  client_seq      INTEGER,                   -- монотонный счётчик клиента в сессии
  origin          TEXT NOT NULL CHECK (origin IN ('client','server')),
  props_json      TEXT NOT NULL DEFAULT '{}',
  flags_json      TEXT NOT NULL DEFAULT '{}' -- например {"context_mismatch":true}
);
CREATE INDEX events_session_idx ON events(session_id);
CREATE INDEX events_agg_idx ON events(funnel_id, funnel_version, variant, name);
CREATE INDEX events_campaign_idx ON events(utm_campaign);

CREATE TABLE ingest_log (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id      TEXT,
  received_at   TEXT NOT NULL,
  accepted      INTEGER NOT NULL,
  duplicates    INTEGER NOT NULL,
  rejected      INTEGER NOT NULL
);

CREATE TABLE rejected_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id      TEXT,
  event_id      TEXT,
  reason        TEXT NOT NULL,
  raw_json      TEXT NOT NULL,              -- обрезать до 4 КБ
  received_at   TEXT NOT NULL
);
```

Сырые ответы живут только в `sessions.state_json`. Это операционные данные для восстановления сессии, а не аналитика. Они никогда не попадают в `events`, не отдаются аналитическим API и не показываются в дашборде. После `expires_at` фоновой задачей при старте и раз в час `state_json.answers` очищается (сессия остаётся для аналитики). Это записать в `docs/DATA_MODEL.md`.

---

## 6. Backend API

Все ответы JSON. Ошибки в формате `{ error: { code, message } }`. Админские маршруты (`/api/admin/*`, `/api/analytics/*`, `/api/live`) защищены Basic Auth из `ADMIN_USER`/`ADMIN_PASSWORD` (в README указать демо-доступ для проверяющих). Публичные маршруты: funnel, sessions, events.

### 6.0. Безопасность и эксплуатация

- `@fastify/helmet` с CSP `default-src 'self'` (шрифты и скрипты свои, внешних источников нет); `@fastify/rate-limit` на `/api/events/batch` и `POST /api/sessions`; CORS не включаем, всё same-origin.
- Basic Auth сравнивает логин и пароль через `crypto.timingSafeEqual`. Демо-доступ из README — отдельные значения в переменных окружения, не в коде.
- Лимиты тела: 256 КБ для событий, 64 КБ для состояния сессии. Все входы валидируются zod-схемами из `packages/shared`.
- `GET /api/health` возвращает версию сборки и статус БД. Логи pino в JSON без значений ответов.
- Graceful shutdown: по `SIGTERM` перестать принимать запросы, закрыть SSE-соединения и базу. Railway шлёт `SIGTERM` при каждом редеплое.

### 6.1. Версии

- `GET  /api/admin/versions` — список версий: state, release_note, когда опубликована, **сколько активных (не истёкших, без результата) сессий на ней сейчас**, сколько сессий всего.
- `GET  /api/admin/versions/active` — активная версия + её конфиг.
- `POST /api/admin/versions` — загрузить новый конфиг как черновик (тело — JSON конфига). Прогоняет схему и линт. Повторная загрузка того же `config_hash` идемпотентна.
- `GET  /api/admin/versions/:v/diff?against=active` — результат `diffConfigs` + линт.
- `POST /api/admin/versions/:v/publish` — черновик → published, плюс строка активации `publish`. Блокируется при ошибках линта.
- `POST /api/admin/rollback` — активирует версию, которая была активна перед текущей (по журналу активаций), строка `rollback`. Если предыдущей нет — 409.
- `POST /api/admin/versions/:v/activate` — активировать любую опубликованную версию (строка `activate`).

Публикация, откат и активация выполняются в одной транзакции. Передеплой не нужен: активная версия читается из БД на каждое создание сессии (можно кешировать в памяти с инвалидацией при записи).

**Семантика отката, записать в README:** откат меняет только то, на какой версии стартуют **новые** сессии. Сессии, начатые на откатываемой версии, продолжают работать на ней до завершения или истечения TTL, потому что версия закреплена за сессией. Версии и события никогда не удаляются, поэтому аналитика после отката не теряется.

### 6.2. Сессии

- `POST /api/sessions` — тело `{ funnelId, utm: {...}, variantOverride?: 'A'|'B', trafficType?: 'synthetic' }`.
  1. Версия = **всегда активная**. Задание требует, чтобы новые сессии запускались только на активной версии, поэтому сессий на черновиках не бывает.
  2. Вариант: при `variantOverride` — он, `variant_source='override'`, `traffic_type='qa'`. Иначе детерминированно: `bucket = fnv1a32(sessionId + ':' + experimentId) % 100`, сравнение с кумулятивными весами. Результат сохраняется в строке сессии, дальше хеш не пересчитывается.
  3. В той же транзакции сервер пишет событие `session_started` с `event_id = 'srv:session_started:' + sessionId`, `origin='server'`.
  4. Ответ: `{ session: { id, funnelVersion, experimentId, variant, state, stateRev, expiresAt }, funnel: ResolvedFunnel }`.
- `GET /api/sessions/:id` — та же форма ответа, `funnel` резолвится **из закреплённой версии**, а не из активной. 404, если нет; 410, если истекла.
- `PUT /api/sessions/:id/state` — `{ state, baseRev }`. Оптимистическая блокировка: если `baseRev !== state_rev`, вернуть 409 с актуальным состоянием (клиент берёт серверное). Сервер валидирует, что `currentStepId` существует в закреплённой версии и что ответы проходят `validateAnswer`.
- `POST /api/sessions/:id/complete` — сервер проверяет, что все шаги `visiblePath` до `result` отвечены и валидны, вычисляет `computeResult`, сохраняет `result_id`, возвращает `{ resultId, result }` с учётом `resultOverrides`. Идемпотентно.

`trafficType: 'synthetic'` принимается только с заголовком `X-Generator-Key` из env `GENERATOR_KEY`. Синтетический трафик показывается в дашборде по умолчанию (иначе генератор бесполезен), а `qa` (override) по умолчанию скрыт фильтром. TTL сессии берётся из `session.ttlHours` закреплённой версии (`expires_at = created_at + ttlHours`).

### 6.3. Почему сервер — источник правды

Версия, вариант, UTM и результат сессии определяются сервером. Клиент не может переназначить себе вариант или «подделать» версию в событиях. При приёме событий эти поля берутся из строки сессии (см. 7.3).

### 6.4. Публичный конфиг

`GET /api/funnel/:funnelId/active` — только мета активной версии (номер, title) для служебных нужд. Фронтенд воронки получает конфиг исключительно через сессию.

---

## 7. События

### 7.1. Схема события от клиента

```ts
{
  event_id: string,          // uuid v7, генерируется в момент создания события, при ретраях не меняется
  session_id: string,
  name: string,
  client_timestamp: string,  // ISO
  client_seq: number,        // монотонный счётчик в рамках сессии, хранится в localStorage
  funnel_id: string,
  funnel_version: number,
  experiment_id: string,
  variant: 'A' | 'B',
  step_id: string | null,
  utm_source?: string, utm_medium?: string, utm_campaign?: string,
  properties: Record<string, string | number | boolean | null>
}
```

### 7.2. Каталог и свойства

Каталог берётся из `events.allowed` **закреплённой версии сессии**. Событие с именем не из каталога отклоняется (`unknown_event`). Значит, событие `recommendation_expanded` принимается только от сессий v3, а сессии v1/v2 его просто не отправляют (фронтенд проверяет каталог своей сессии, раздел 8.4). Свойства фильтруются по whitelist из каталога, лишние ключи отбрасываются и помечаются в `flags_json.dropped_props`. Это и есть защита приватности: сырому ответу некуда попасть.

`answer_submitted.properties.answer_kind` формируется функцией `answerKind(step, value)`: `single_select`, `multi_select:<count>`, `number`. Никаких значений ответа. Для понимания веток в аналитике значения не нужны: факт ветвления виден по `step_viewed` условных шагов (`office_days`, `security_constraints`).

`client_timestamp` у серверных событий = `server_ts`.

### 7.3. Endpoint приёма

`POST /api/events/batch`, тело `{ batch_id?: string, events: ClientEvent[] }`, максимум 100 событий и 256 КБ.

Алгоритм `apps/server/src/modules/events/service.ts`:

1. Парсим конверт. Если сам конверт кривой — 400. Если конверт валиден — **всегда 200**, даже если все события внутри отклонены.
2. Для каждого события отдельно: zod-валидация базовых полей → сессия существует → имя в каталоге версии сессии → свойства по whitelist → `step_id` существует в версии (если не null).
3. Обогащение из сессии: `funnel_version`, `experiment_id`, `variant`, `utm_*` берутся из строки сессии. Если клиент прислал другие значения, сохраняем серверные и ставим `flags_json.context_mismatch = true`.
4. Вставка `INSERT ... ON CONFLICT(event_id) DO NOTHING`, вся пачка в одной транзакции. `changes() === 0` → статус `duplicate`.
5. Ответ: `{ results: [{ event_id, status: 'accepted' | 'duplicate' | 'rejected', reason? }], accepted, duplicates, rejected }`. Отклонённые пишутся в `rejected_events`, итог пачки в `ingest_log`.
6. События `session_started` от клиента отклоняются с reason `server_only`.

Свойства, которые это даёт и которые надо проверить тестами: повтор того же `event_id` не создаёт дубль; повтор всей пачки после таймаута безопасен (все `duplicate`, данные не меняются); одно битое событие не мешает остальным; порядок прихода не важен.

### 7.4. Клиентская очередь (`apps/web/src/features/funnel/eventQueue.ts`)

- Событие создаётся с `event_id` и `client_seq` и сразу кладётся в outbox в `localStorage` (ключ по session_id).
- Флаш каждые 2 секунды или при 10 событиях; при `visibilitychange → hidden` через `navigator.sendBeacon`.
- Из outbox удаляются только события со статусом `accepted` или `duplicate`. `rejected` удаляются с `console.warn`. При сетевой ошибке или 5xx — повтор с экспоненциальной задержкой (1, 2, 4, 8, макс. 30 с) и тем же `event_id`.
- После refresh outbox досылается.
- `sendBeacon` не возвращает ответ, поэтому события, отправленные через него, **не удаляются** из outbox и будут отправлены ещё раз при следующем открытии. Это безопасно благодаря дедупликации по `event_id` и ровно поэтому она нужна.

### 7.5. Когда шлём какое событие

| Событие | Когда | step_id | properties |
|---|---|---|---|
| `session_started` | сервер, при создании сессии | null | — |
| `step_viewed` | шаг отрисован (каждый раз, включая повторный показ после back/refresh) | шаг | `step_type`, `visible_step_index`, `visible_step_count` |
| `answer_submitted` | валидный ответ отправлен | шаг | `answer_kind` |
| `step_completed` | переход вперёд с валидного интерактивного шага | шаг | `next_step_id` |
| `back_clicked` | кнопка Back или браузерная «назад» | шаг, с которого ушли | `destination_step_id` |
| `result_viewed` | результат отрисован | `result` | `result_id` |
| `cta_clicked` | клик по основной CTA | `result` | `result_id`, `action` |
| `recommendation_expanded` (только v3, добавляется в Фазе 7) | после CTA раскрыт подробный план | `result` | `result_id`, `action`, `source` |

Для `info`-шагов `step_completed` не шлётся (так сказано в конфиге: trigger — interactive step). Прохождение intro аналитика выводит из достижения следующих шагов (раздел 11.2, правило implied reach).

---

## 8. Frontend воронки

### 8.1. Жизненный цикл сессии (`useFunnelSession`)

1. Маршрут `/` (воронка по умолчанию `workstyle-planner`), шаг в URL: `/s/:stepId`. Навигация через history API, поэтому браузерная «назад» работает и шлёт `back_clicked`.
2. `localStorage['funnel:workstyle-planner:session']` → `GET /api/sessions/:id`.
   - 404/410 → новая сессия; при 410 показать ненавязчивую строку «Your previous answers expired, starting over».
   - Если в URL `?variant=X` и X не совпадает с вариантом текущей сессии → создать новую сессию с override (записать решение в DECISIONS.md: override действует только при создании сессии, чтобы назначение оставалось стабильным).
3. Иначе `POST /api/sessions` с UTM из URL (UTM фиксируются один раз при создании).
4. Состояние `{ answers, history, currentStepId }` хранится на сервере (источник правды) и зеркалируется в localStorage для мгновенного рендера после refresh. При расхождении побеждает больший `stateRev`.
5. Сохранение состояния `PUT .../state` с debounce 300 мс и сразу при переходе между шагами.

### 8.2. Рендер

API меняется только аддитивно: новые поля и маршруты добавляются, старые не удаляются и не меняют смысл. Так вкладка со старым бандлом и неотправленным outbox продолжает работать после деплоя второй итерации.

Реестр компонентов по `step.type`. **Неизвестный тип → `UnknownStep`** («This step isn't available, continue»), а не падение. Это гарантия совместимости: новый фронтенд со старой сессией и старый кешированный бандл с новой версией не ломаются.

Компоненты шагов получают только `step`, `value`, `onChange`, `error` и ничего не знают о воронке. Тексты — только из конфига. В коде нет строк с вопросами, вариантами ответов или названиями результатов.

UX-требования (это часть оценки «продуктовые решения»):
- клавиатура: цифры 1–9 выбирают опцию, Enter — Continue, Esc/Alt+← — Back;
- ошибки валидации показываются после попытки продолжить, затем live при исправлении, `role="alert"`;
- кнопка Continue неактивна, пока нет значения, но валидация всё равно серверная;
- multi-select показывает счётчик «2 of 3 selected» и не даёт выбрать больше `maxSelections`;
- number: крупный ввод, кнопки −/+, диапазон под полем, `inputmode="numeric"`;
- прогресс: сегментная полоса только из видимых интерактивных шагов, плюс текст «2 of 6»; при изменении ответа, открывающего новый шаг, total плавно меняется;
- результат: заголовок, summary, блок «What a week could look like» (см. 8.3), список рекомендаций, CTA; по клику CTA с `action: expand_recommendation` раскрывается подробный план на 30 дней (сгенерированный из `recommendations`, без новых захардкоженных текстов, кроме заголовков UI);
- состояния загрузки и ошибки результата используют `loadingTitle`, `errorTitle`, `retryLabel` из конфига.

### 8.3. Блок «неделя команды» на результате

Сетка Пн–Пт × AM/PM, раскраска по `resultId` из небольшой таблицы-маппинга в коде (`office`, `focus`, `async`, `free`). Это визуальная интерпретация, а не контент, поэтому маппинг в коде допустим; для неизвестного resultId блок просто не показывается. Пример раскраски есть в `docs/design/reference.html`.

### 8.4. События на клиенте

Хелпер `track(name, stepId, properties)` проверяет, что `name` есть в каталоге **текущей сессии**, иначе молча не шлёт. Так сессия v2 на новом фронтенде никогда не отправит `recommendation_expanded`.

### 8.5. Debug-оверлей

`?debug=1` (или Shift+D) показывает плашку в углу: session id, версия, вариант и источник, видимый путь, stateRev, длина outbox, кнопка «Reset session». Это сильно помогает проверяющим и тебе самому.

---

## 9. Генератор трафика и сверка

### 9.1. `pnpm generate`

Флаги: `--sessions 150` (минимум 100), `--seed 42`, `--base-url http://localhost:3000`, `--out .generated/ground-truth.json`, `--publish-next`. Секреты берутся из окружения: `GENERATOR_KEY` для синтетических сессий и `ADMIN_USER` / `ADMIN_PASSWORD` для публикации в режиме `--publish-next`.

С `--publish-next` (режим по умолчанию для демо) генератор создаёт ~40% сессий на активной версии, часть из них оставляет незавершёнными, затем публикует следующий черновик через админский API, создаёт остальные сессии уже на новой версии и **дозавершает старые сессии на старой версии**. Так после одного запуска в дашборде есть данные для сравнения версий, а заодно демонстрируется закрепление версии. Ground truth ведётся отдельно по каждой версии. Без флага все сессии идут на текущую активную версию.

Генератор работает **через настоящее HTTP API** (создание сессий, сохранение состояния, complete, отправка пачек), с `trafficType: 'synthetic'`. Так он проверяет весь конвейер, а не пишет в базу в обход.

Детерминированный ГПСЧ (mulberry32 от seed). Поведение:
- UTM: 3–4 кампании (`spring_launch`, `partner_webinar`, `linkedin_retarget`, `newsletter_may`), разные source/medium, ~10% без UTM;
- вариант назначает сервер (естественные 50/50), плюс 4 сессии с override, которые по умолчанию не видны в дашборде (проверка фильтра);
- персоны с разными ответами, чтобы пройти все ветки: remote+global, remote+same, hybrid, office, high async maturity и т. д.;
- отвал: на каждом шаге есть вероятность уйти; для варианта B вероятность отвала на первых двух вопросах ниже, а вероятность CTA выше (заложенный эффект, описать в README честно как синтетический);
- back: ~20% сессий делают 1–2 возврата и повторно смотрят шаги;
- дубли: ~15% событий отправляются дважды внутри одной пачки или в соседних пачках;
- повтор пачки целиком: ~10% пачек отправляются повторно (имитация таймаута);
- не по порядку: ~10% сессий отправляют события в перемешанном порядке, включая `cta_clicked` раньше `result_viewed`;
- 3–5 заведомо битых событий (неизвестное имя, несуществующая сессия, без event_id) для панели качества данных.

Генератор сам ведёт **ground truth**: по каждой сессии он знает, какие шаги она реально прошла, до чего дошла, был ли клик CTA. В конце пишет `ground-truth.json` с ожидаемыми метриками в той же форме, что отдаёт `/api/analytics/summary`, и печатает таблицу в консоль.

### 9.2. `pnpm verify`

Запрашивает аналитику с теми же фильтрами и сравнивает с ground truth поле за полем. Выводит зелёное «OK» или список расхождений, exit code ≠ 0 при расхождении. Этот же сценарий оформлен как интеграционный тест (раздел 12). В дашборде показывается строка «Matches generator ground truth: Yes/No», если файл ground truth существует.

---

## 10. Дизайн

Эталон: `docs/design/reference.html`. Открой его в браузере (вкладки сверху: Dashboard, Versions, Live events, Single-select, Number, Result; попробуй клик по шагу в journey, ⌘K и кнопку Publish) и повтори токены, типографику, компоновку и компоненты. Если текст ниже и эталон расходятся в деталях, прав эталон, кроме случаев, где текст явно говорит об обратном (шрифт без Google Fonts). Токены из его `:root` перенеси в `apps/web/src/design/tokens.css` один в один, иконки — из `<symbol>` в начале файла (или эквиваленты из `lucide-react`).

Направление: мягкий светлый SaaS-интерфейс. Серо-голубой фон, крупные полупрозрачные светлые панели (радиус 28px, без `backdrop-filter`) с белыми карточками внутри и мягкими тенями, чёрные «пилюли» для активных элементов, круглые кнопки-иконки. Вариант A всегда мягко-синий (`--a`), вариант B всегда коралловый (`--b`), во всех графиках, барах и подписях без исключений.

Главный элемент дашборда — **Funnel journey**, повторяет композицию референса (SaaS-дашборд с картой пути клиента):
- шаги воронки в порядке `stepSequence` выбранного варианта, разложенные по белым колонкам-карточкам (радиус 24px) до 3 шагов в колонке; подписи колонок под карточками («Start», «Questions 2–4»);
- **колонки соединены плавными кривыми** (SVG-слой поверх journey, кубические кривые от середины правого края колонки к каждому шагу следующей колонки, маленькие кружки-«порты» на концах). Координаты считаются из реальных `getBoundingClientRect`, перерисовка через `ResizeObserver`. В React это компонент `JourneyLinks`, принимающий refs колонок;
- строка шага: кольцо (step pass rate, цвет текущего варианта) вместо аватара, название и «N reached», справа серая двойная галочка и круглая кнопка-иконка деталей. **Шаг с наибольшим отвалом** выделяется: жирное название, кольцо и подпись «N left here» коралловые, многоточие вместо галочки, а линия к нему — коралловый пунктир. Остальные шаги приглушены. Это повторяет приём референса «текущий шаг жирный, остальные серые» и сразу показывает проблемное место;
- условные шаги (`visibleWhen`) — коралловая пунктирная рамка и бейдж условия из конфига («if hybrid or office»);
- последняя колонка — сетка плиток 2×3: первая чёрная «Reached result» (в неё входит линия со стрелкой), дальше «CTA clicked» и разбивка по результатам;
- **«вырез» в верхней кромке панели** (notch с вогнутыми углами, как полоса аватаров в референсе) с круглыми «аватарами» источников трафика (`utm_source`) и бейджами-счётчиками сессий; клик фильтрует дашборд по источнику.

Остальная админка в той же логике: навигация в шапке — простой текст, активный пункт чёрная пилюля (без подложки под всеми вкладками); справа круглые кнопки поиска (открывает ⌘K) и уведомлений и аватар; слева колонка круглых кнопок, внизу тёмная круглая кнопка настроек. Секции — матовые светлые панели (радиус 28px) с белым внутренним ободком; в шапке каждой панели справа круглые кнопки-иконки с тонкой обводкой. Таблицы без отдельной подложки, мелкий серый заголовок колонок, статусы — **сплошные** пилюли: синяя (Stored, Handled, Published), коралловая (Rejected), чёрная (Active, Matches), белая с обводкой (Ignored), пунктирная (Draft). A/B — толстые полукольца (как донаты в референсе) синего и кораллового цвета с белым кружком-счётчиком у края и процентом в центре.

Правила (главное — сдержанность: тонкие линии вместо толстых рамок, мягкие тени, никаких весов 700+, чёрный только для одного активного элемента в группе, основной кнопки и плитки «Reached result»):
- **только светлая тема**: `color-scheme: light`, без `prefers-color-scheme: dark` и без переключателя тем;
- шрифт Plus Jakarta Sans (вариативный, только `@fontsource-variable/plus-jakarta-sans`, см. раздел 2) с фолбэком system-ui; цифры везде `tabular-nums`. Текст интерфейса мелкий (11–13px), заголовки 600 с лёгким отрицательным трекингом, крупные числа 600 с трекингом −0.04em;
- воронка для пользователя: одна белая карточка 560px по центру на фоне `--bg`; выбранный ответ — белая карточка с тонкой тёмной обводкой 1.5px, лёгким голубым тоном и заполненной радиокнопкой (не сплошная чёрная заливка); прогресс — ряд скруглённых сегментов (пройдено — чёрный, текущий — `--a`); кнопки — чёрные пилюли;
- админка: см. абзацы выше; KPI — 4 полупрозрачные белые карточки с двумя тонкими барами A/B; рейл слева на мобильном скрывается;
- движение: в ответ на действие (выбор опции, раскрытие, тост, смена экрана) плюс один момент при загрузке дашборда (досчёт KPI, заполнение колец и шкал) и пульс индикатора «Receiving events». Больше фоновых анимаций нет. `prefers-reduced-motion` отключает всё это;
- адаптив до 360px без горизонтальной прокрутки страницы (широкие блоки вроде journey скроллятся внутри себя), видимый фокус, контраст AA;
- тексты UI в sentence case, глаголы действия: «Continue», «Publish version 3», «Roll back to version 2». Тост повторяет глагол: «Published», «Rolled back».

### 10.1. Современные техники (обязательно, всё есть в эталоне)

Используй возможности платформы, а не тяжёлые библиотеки. Для каждой техники нужен фолбэк: если браузер её не поддерживает, интерфейс работает без анимации, но не ломается.

- **Цвета в OKLCH**, мягкие варианты через `color-mix(in oklch, …)`. Токены — только CSS-переменные, никаких цветов в компонентах.
- **View Transitions API** для смены экранов админки и шагов воронки: `document.startViewTransition` в хелпере `withViewTransition(fn, { back })` из `lib/viewTransition.ts`, внутри обновление через `flushSync`. Шаг воронки «уезжает» влево при Continue и вправо при Back (класс `back` на `<html>`), карточка и прогресс морфятся через `view-transition-name`. Без поддержки — мгновенная смена.
- **`<dialog>` + `showModal()`** для подтверждения публикации и отката, с размытием `::backdrop`. Вход и выход анимируются через `@starting-style` и `transition-behavior: allow-discrete`.
- **Командная палитра по ⌘K / Ctrl+K** (тоже `<dialog>`): переход на страницы, «Publish version N», «Roll back to version N», «Open funnel as variant B», поиск сессии по id. Стрелки и Enter, фильтрация по вводу.
- **Popover API + CSS anchor positioning** для подробностей шага в Funnel journey: клик по узлу открывает поповер у узла с цифрами A/B (reached, completed, left here, came back). Без поддержки anchor positioning — позиционирование через `getBoundingClientRect`.
- **Тосты через `popover="manual"`**: после публикации тост «Published version 3» с кнопкой «Roll back», после отката — «Rolled back to version 2». Живут 5 секунд.
- **`@property`** для анимации колец (`--p`) и полукруглых шкал при загрузке дашборда, вместе с досчётом цифр KPI.
- **Container queries** для KPI-карточек (спарклайн прячется в узкой карточке) и колонок journey.
- **`text-wrap: balance`** для заголовков, `text-wrap: pretty` для абзацев, `field-sizing: content` для числового ввода, `:user-invalid` и `:has()` для подсветки ошибки поля без JS.
- **Пружинная анимация через `linear()`** (токен `--spring`) для нажатий, выбора опции и появления элементов.
- **Матовое стекло** (`backdrop-filter`) только в двух местах: липкая шапка админки и карточка воронки поверх мягкого цветного свечения на фоне. Панели админки полупрозрачные, но без размытия: так дешевле для отрисовки.
- **Появление новых строк** в Live events через `@starting-style` (сама страница описана в 11.1).
- **Спарклайн** в карточке Started (сессии по дням, inline SVG с градиентной заливкой) и дельта к предыдущей версии в остальных KPI.
- **Раскрытие плана на 30 дней** после CTA через `grid-template-rows: 0fr → 1fr`, без измерения высоты в JS.

Админка (Dashboard, Versions, Live events) — полноценная часть продукта, а не служебная заглушка: проверяющие проведут в ней больше всего времени.

---

## 11. Админка и аналитика

### 11.1. Страницы (`/admin`, Basic Auth)

- **Versions:** таблица версий (номер, состояние, release note, когда активирована, активные сессии сейчас, всего сессий), журнал активаций. Загрузка JSON-файла как черновика. Для черновика — кнопка «Review changes», показывающая diff и линт относительно активной версии, затем «Publish version N». Кнопка «Roll back to version N» с подтверждением, в котором указано, сколько сессий останется на текущей версии. Ссылка «Preview» открывает версию в режиме предпросмотра: `GET /api/admin/versions/:v/preview?variant=A|B` отдаёт резолвнутый конфиг, фронтенд проходит воронку с состоянием только в памяти, **без создания сессии и без отправки событий**, с плашкой «Preview, not tracked». Так предпросмотр не нарушает правило «новые сессии только на активной версии» и не засоряет аналитику.
- **Dashboard:** см. 11.2.
- **Live events:** поток входящих событий в реальном времени через SSE (`GET /api/live`, heartbeat-комментарий каждые 15 с, чтобы прокси Railway не закрывал соединение; при переподключении клиент получает последние 50 записей). По строке на событие: время, session (коротко), name, step, version, variant, статус `accepted` / `duplicate` / `rejected` с причиной. Фильтры по статусу и по session id, пауза, новые строки сверху. Это лучший способ показать проверяющему, что дедупликация реально работает.

### 11.2. Правила агрегации (`packages/shared/src/analytics/aggregate.ts`)

Агрегатор — чистая функция `aggregate(sessions, events, resolvedFunnels, filters)`. Сервер выбирает строки SQL-запросом с фильтрами и передаёт их в агрегатор. На объёмах тестового задания это быстро и легко тестируется; в LIMITATIONS.md отметить, что на больших объёмах это переводится в инкрементальные агрегаты.

Единица счёта — **уникальная сессия**. Всё считается через множества, поэтому дубли и порядок прихода событий на результат не влияют.

Для каждой сессии строится профиль:
- `reached(step)` = есть `step_viewed` или `answer_submitted` или `step_completed` по этому шагу (implied reach: если шаг завершён, значит, его видели, даже если `step_viewed` потерялся или пришёл позже);
- `reachedResult` = есть `result_viewed` или `cta_clicked`;
- `clickedCta` = есть `cta_clicked`;
- `furthestIndex` = максимальный индекс в `stepSequence` варианта среди достигнутых шагов. **Именно индекс в последовательности, а не время последнего события**: возвраты назад и порядок прихода не влияют.

Метрики:
- **Started** = сессии с `session_started` (оно серверное, поэтому гарантировано) в выборке фильтров.
- **Reached(step)** по шагам в порядке `stepSequence` выбранного варианта.
- **Step pass rate(step)** = сессии, которые достигли шага и имеют `step_completed` по нему **или** достигли любого более позднего шага / результата, делённые на reached(step). Метрика корректна для условных шагов: её знаменатель — только те, кому шаг показали.
- **Dropped here(step)** = сессии без результата, **неактивные дольше 30 минут** (по последнему `server_ts`), у которых `furthestIndex` указывает на этот шаг. Сессии без результата с активностью в последние 30 минут показываются отдельно как **In progress**, чтобы живые пользователи не считались отвалившимися. Порог — константа, записать в ANALYTICS.md. **Порог применяется только к `live`-трафику**: синтетические сессии генератора считаются завершёнными сразу, иначе сразу после запуска генератора все его «брошенные» сессии полчаса висели бы в In progress, а `verify` расходился бы с ground truth.
- **Result rate** = reachedResult / started.
- **CTA CTR** = clickedCta / reachedResult (по сессиям).
- **Started → CTA** = clickedCta / started. **Это основная метрика эксперимента.**
- **Back usage** = доля сессий с хотя бы одним `back_clicked` (guardrail).
- **Branch split**: доля сессий, увидевших каждый условный шаг, среди достигших шага-родителя (шага, на ответ которого ссылается его `visibleWhen`).

Сравнения:
- **A vs B** внутри выбранной версии: все метрики по вариантам, для основной — 95% доверительный интервал Уилсона, двусторонний z-test двух пропорций, p-value, абсолютная разница в п.п. и оценка, сколько сессий на вариант нужно, чтобы такая разница стала значимой (α=0.05, мощность 0.8). Вердикт текстом, честно: «B is ahead by X points, but the difference is not significant yet». Никогда не писать «B wins» при p ≥ 0.05.
- **Версии**: панель Versions compared (ниже). Пошаговые данные — только для выбранной версии, потому что наборы шагов у версий разные.
- **Фильтры**: версия, вариант (A/B/оба), **`utm_campaign` (обязателен по заданию, список из данных)**, период, переключатель «Include QA sessions» (override). Вырез с `utm_source` в Funnel journey — дополнительный фильтр, он не заменяет фильтр по кампании.
- **Качество данных**: проигнорировано дублей (из `ingest_log`), событий пришло не по порядку (у которых `client_seq` меньше максимального уже принятого в сессии на момент приёма — считать при вставке и класть в `flags_json.out_of_order`), отклонено с разбивкой по причинам, событий с `context_mismatch`.

Состав дашборда (эталон показывает не всё — недостающие блоки делаются в том же стиле):
- KPI-карточки, Funnel journey, Data quality, A/B — как в эталоне;
- в шапке Funnel journey переключатель **Journey / Table**: табличный вид с точными числами по каждому шагу (reached, completed, step pass rate, dropped here, отдельно A и B). Проверяющим нужно сверять числа, а не только смотреть на кольца;
- панель **Versions compared**: таблица KPI по всем версиям (started, result rate, CTA CTR, started → CTA, in progress), активная версия помечена;
- панель **Other events**: для каждого события из каталога выбранной версии, которого нет среди 7 базовых, — число уникальных сессий и доля от сессий с CTA. Список строится из каталога, поэтому `recommendation_expanded` появится для v3 без изменения кода дашборда.

API: `GET /api/analytics/summary?version=&variant=&campaign=&from=&to=&includeQa=` → всё выше одним JSON. `GET /api/analytics/filters` → доступные версии и кампании.

Все правила продублировать человеческим языком в `docs/ANALYTICS.md` с примером: «сессия посмотрела team_size, нажала back, снова посмотрела team_size — reached(team_size) = 1».

---

## 12. Тесты (обязательный минимум и сверх него)

Обязательные по заданию, каждое отдельным describe:

1. **Закрепление версии:** сессия создана на v1 → публикуем v2 → `GET` сессии отдаёт конфиг v1, `PUT state` с шагом из v1 проходит; новая сессия получает v2.
2. **Стабильность варианта:** повторный `GET` и 20 повторных чтений дают тот же вариант; `assignVariant` детерминирован для пары (sessionId, experimentId); на 10 000 id распределение 50±2%; override работает и помечается `qa`.
3. **Дедупликация:** то же событие дважды в одной пачке, в двух пачках и повтор всей пачки → одна строка, корректные статусы; битое событие в пачке не мешает остальным; событие не из каталога версии отклоняется; лишние свойства отбрасываются.
4. **Публикация и откат:** publish блокируется при ошибке линта; publish v2 делает её активной; rollback возвращает v1; сессии v2 продолжают работать после отката; журнал активаций содержит все шаги; события не удаляются.
5. **Аналитика:** фикстура из ~10 сессий с повторными просмотрами, back, дублями и перемешанным порядком → точные ожидаемые числа reached, pass rate, dropped, result rate, CTR, A/B.

Дополнительно:
- движок: каждый оператор; `visiblePath` для remote/hybrid; progress меняет total; `effectiveAnswers` игнорирует ответы скрытых шагов; линт ловит условие, ссылающееся на более поздний шаг;
- **схема не меняется при публикации v3:** снимок `sqlite_master` до и после публикации идентичен;
- **совместимость:** сессия v2 в середине шага `tool_count` варианта B → публикация v3 (где у B нет `tool_count`) → сессия доходит до результата без ошибок;
- интеграционный: генератор на 120 сессий с `--publish-next` против локального сервера → `verify` без расхождений по обеим версиям;
- нельзя создать сессию на неактивной версии: preview-маршрут не создаёт строк в `sessions` и `events`;
- dropped vs in progress: сессия без результата с недавней активностью не попадает в dropped.

E2E (Playwright, `pnpm e2e`, обязательные, против собранного приложения на временной базе):
- воронка: пройти ветку hybrid до результата и CTA; refresh посередине сохраняет шаг и ответы; Back возвращает на предыдущий видимый шаг; `?variant=B` даёт порядок шагов B; прогресс у remote меньше, чем у hybrid;
- админка: опубликовать v2, убедиться, что новая сессия на v2, а начатая на v1 продолжает v1; откатить; дашборд после генератора показывает «Matches generator ground truth: Yes»;
- события: в Live events видно `duplicate` при повторной отправке пачки.

Тесты движка и ingest пишутся **до** реализации (TDD), остальные — вместе с кодом. Тесты, которым нужен v3 (схема БД при публикации v3, совместимость сессии v2 с публикацией v3), пишутся в Фазе 7.

---

## 13. План работ по фазам

Каждая фаза живёт в своей ветке и заканчивается слиянием в `main` через pull request по процессу 13.1: зелёный CI (`pnpm check`, с Фазы 3 ещё `pnpm e2e`), ревью субагента `reviewer` без открытых блокеров, записи в `docs/AGENT_LOG.md` и `docs/TIMELINE.md` (время начала и конца, что сделано, что проверено, что нашёл ревью). Railway автоматически деплоит `main`, поэтому каждая завершённая фаза сразу видна на публичном URL.

**Работай автономно**: человек код не проверяет, поэтому между фазами не жди подтверждения, а переходи к следующей, если ворота зелёные. Останавливайся и спрашивай человека только когда без него нельзя: настройка Railway в Фазе 0, доступы и секреты, неустранимая блокировка, и в самом конце перед сдачей. После каждой фазы пиши человеку короткий отчёт в 3–5 строк: что готово, что открыть, чтобы увидеть результат.

### 13.1. Ветки, задачи и слияние (через GitHub MCP)

**Планирование в GitHub.** В начале каждой фазы создай milestone `Phase N — <название>` и по issue на каждую задачу фазы (заголовок, ссылка на раздел этого файла, критерии готовности чек-листом, метка `phase-N` и метка области: `shared`, `server`, `web`, `infra`, `docs`). Задача — кусок работы на 30–90 минут с одним понятным результатом. Так декомпозиция видна проверяющим прямо в репозитории.

**Ветки.**
- `main` — всегда рабочая и задеплоенная версия. Прямых коммитов нет, только слияние PR.
- `phase/N-<slug>` — ветка фазы, создаётся от свежего `main` (например, `phase/1-shared-engine`).
- `task/N.M-<slug>` — ветка задачи, создаётся от ветки фазы (например, `task/1.3-navigation`). Одна задача — одна ветка — один PR — один issue.

**Задача → фаза.** PR из `task/…` в `phase/…`. Описание по шаблону `.github/pull_request_template.md`: что сделано, почему так, как проверено, ссылки на разделы спецификации, `Closes #<issue>`. Условия слияния: CI зелёный; субагент `reviewer` оставил ревью-комментарий в PR без открытых `blocker` и `major` (найденное исправляется в той же ветке). Слияние — **squash**, сообщение в формате Conventional Commits (`feat(engine): …`, `fix(ingest): …`). Ветка задачи после слияния удаляется.

**Фаза → main.** Когда все issues фазы закрыты: PR из `phase/…` в `main` с описанием фазы (что готово, что открыть на проде, итог ревью). Условия: CI и e2e зелёные, итоговое ревью `reviewer` по всей фазе, отметки в `docs/REQUIREMENTS.md` для закрытых пунктов. Слияние — **merge commit** (не squash), чтобы история задач фазы осталась видна в `main`. После слияния: milestone закрыт, деплой на Railway прошёл, `/api/health` отвечает (проверить через Railway MCP или запросом).

**Параллельная работа.** Задачи одной фазы, которые не трогают одни и те же файлы, ведутся параллельно субагентами в отдельных `git worktree` (по worktree на ветку задачи). Фазы 3, 4 и 5 после слияния Фазы 2 можно вести параллельно: у каждой своя ветка фазы от `main`; в `main` они вливаются по очереди, следующая перед слиянием подтягивает `main` и прогоняет CI заново.

**Защита `main`.** В Фазе 0 включи правило: слияние только через PR и только при зелёной проверке CI. Ревью-апрув не требуй: PR создаются от аккаунта человека, а GitHub не даёт одобрять свои же PR; роль ревью выполняет комментарий `reviewer` плюс обязательный CI. Если правило нельзя включить через MCP или `gh`, попроси человека (Settings → Branches/Rules) и дай точные шаги.

**Railway.** Деплой только из `main` (автодеплой по GitHub). PR-окружения Railway не включать: пробного кредита на них не хватит.

**Чего не делать:** коммитить в `main` напрямую, сливать красный PR, сливать PR с открытыми блокерами, делать задачи без issue, переписывать историю `main` (force-push).

### 13.2. Фазы

**Фаза 0 — каркас, ворота качества и деплой (≈2 ч).** Монорепо, пустые приложения, `tsconfig.base.json`, Vitest workspace, Playwright, все инструменты качества из 3.1 с рабочими конфигами, `pnpm check` зелёный на пустом проекте, lefthook, CI, `.claude/agents/reviewer.md` и `.claude/settings.json` (раздел 14). `pnpm dev` поднимает сервер и веб. Drizzle-схема и первая сгенерированная миграция, `GET /api/health`. GitHub: метки, milestone и issues Фазы 0, шаблон PR, CI-workflow, правило защиты `main` (13.1). Фаза 0 — единственная, где первый коммит каркаса допустим напрямую в `main`, потому что CI и защита ещё не существуют; всё остальное в ней уже идёт через ветку и PR. Dockerfile, railway.json, `.env.example` (`DATABASE_PATH`, `PORT`, `ADMIN_USER`, `ADMIN_PASSWORD`, `GENERATOR_KEY`). Railway настрой сам через Railway MCP (или CLI): проект и сервис из GitHub-репозитория с автодеплоем `main`, volume `/data`, переменные окружения (секреты сгенерируй и покажи человеку один раз, в репозиторий не коммить), публичный домен, healthcheck. От человека нужна только авторизация в Railway и, если попросит Railway, доступ его GitHub-приложения к репозиторию. Деплой «hello» на публичный URL сразу, чтобы проблемы хостинга всплыли в первый час, а не в последний.

**Фаза 1 — shared-движок (≈3 ч, TDD).** Схема конфига, условия, resolve, навигация, валидация, результат, линт, diff, answerKind, схема событий. Тесты используют v1 и v2 и синтетические фикстуры. v3 в этой фазе не открывается.

**Фаза 2 — сервер: версии и сессии (≈3 ч).** seed, versions/publish/rollback/activate, sessions create/get/state/complete, назначение варианта, серверный `session_started`. Тесты 1, 2, 4.

**Фаза 3 — воронка на фронте (≈5 ч).** Токены и глобальные стили по эталону, `useFunnelSession`, все типы шагов, история и URL, прогресс, результат с неделей и CTA, debug-оверлей.

**Фаза 4 — события (≈3 ч).** Ingest с каталогом и whitelist, клиентская очередь с outbox и ретраями, проводка всех `track` в воронке. Тест 3.

**Фаза 5 — аналитика и админка (≈5 ч).** Агрегатор и stats (TDD, тест 5), API, страницы Versions, Dashboard, Live events.

**Фаза 6 — генератор, verify, документация (≈3 ч).** Генератор, ground truth, verify, интеграционный тест. README и docs/*. Деплой, прогон генератора на проде, проверка дашборда.

Здесь первая итерация закончена. Тег `iteration-1` на `main` и GitHub Release с кратким описанием. Отметить время в TIMELINE.md.

**Фаза 7 — вторая итерация (≈2 ч).** Только теперь работаем с v3:
1. Загрузить v3 через «Upload config» в админке (или API) как черновик, прогнать линт и diff, зафиксировать вывод в TIMELINE.md.
2. Убедиться, что движок уже поддерживает `contains` и что UI корректно обрабатывает `recommendation_expanded`; дописать только то, что реально не хватает, каждое изменение — отдельный коммит с объяснением.
3. Скрипт `pnpm demo:iteration2`: создаёт несколько сессий на активной версии (v2), часть останавливает посередине (в т. ч. B на `tool_count`), загружает `configs/funnel-v3.json` через `POST /api/admin/versions` и публикует его, продолжает старые сессии до результата, создаёт новые на v3 (проходит ветку compliance → `security_constraints`, у B нет `tool_count`, шлёт `recommendation_expanded`), выполняет rollback на v2, проверяет, что новые сессии снова на v2, сессии v3 доживают, аналитика по v1/v2/v3 доступна, схема БД не изменилась. Печатает чек-лист с ✔/✘.
4. Выполнить это на проде, итог записать в TIMELINE.md. Тег `iteration-2` на `main` и GitHub Release.

**Фаза 8 — полировка (остаток времени).** `pnpm screenshots` и README по 15.1. Playwright-скриншоты ключевых экранов на ширине 390px и 1440px и сравнение с эталоном, доступность (`@axe-core/playwright` в e2e), пустые состояния админки, финальная вычитка README, `docs/ARCHITECTURE.md` и `docs/EXPLAIN.md`.

---

## 14. Работа с агентами (часть оценки)

Человек код не читает, поэтому ревью и контроль качества — автоматические и делаются агентами. Это нужно честно отразить в AGENT_LOG: **не писать, что код проверял человек**. Писать, что проверяли ворота качества, e2e и субагент-ревьюер, и что именно они нашли.

**Декомпозиция и параллельность**
- Фаза 1 делается последовательно: это контракт (`packages/shared`, включая `api/contract.ts`), на котором стоит всё остальное. После неё публичные интерфейсы `@funnel/shared` замораживаются; изменение контракта — только с записью в DECISIONS.md и прогоном всех тестов.
- Параллельная работа — по правилам 13.1 (worktree на ветку задачи, фазы 3–5 параллельно). Каждому субагенту: issue задачи, ссылки на разделы этого файла, список файлов, которые ему можно трогать, и критерий готовности «CI зелёный + его тесты».

**Субагент `reviewer` (`.claude/agents/reviewer.md`, создать в Фазе 0)**
Только чтение и запуск команд, без правок. Запускается на каждый PR (задачи и фазы) и оставляет результат ревью-комментарием в PR через GitHub MCP. Возвращает список находок с уровнем `blocker` / `major` / `minor` и ссылкой на файл и строку. Чек-лист:
1. Инварианты из разделов 6–7 и 11.2: версия и вариант берутся из сессии; дедупликация по `event_id`; битое событие не роняет пачку; метрики по уникальным сессиям; новые сессии только на активной версии.
2. Приватность: значения ответов не попадают в события, логи, ответы аналитических API.
3. Единые источники правды из 3.1: нет ли второго определения типа, схемы, правила, цвета или компонента; нет ли логики движка или агрегатора в маршрутах, компонентах, генераторе.
4. Границы слоёв из 3.1.
5. Тесты: проверяют поведение, а не реализацию; нет ли тестов, которые всегда зелёные.
6. Соответствие эталону дизайна и правилам раздела 10.
7. Соответствие таблице из раздела 16.
Все `blocker` и `major` исправляются до перехода к следующей фазе.

**Хуки Claude Code (`.claude/settings.json`, создать в Фазе 0, сверившись с актуальной документацией Claude Code по hooks)**
- после правки файлов — Prettier и ESLint `--fix` по изменённым файлам;
- при завершении ответа (Stop) — `pnpm check`; если он красный, агент не заканчивает работу, а чинит. Хук должен ничего не делать, пока нет `package.json`, и не зацикливаться (учитывать флаг повторного срабатывания).

**Журнал и честность**
- `docs/AGENT_LOG.md` ведётся по ходу: что делегировано и кому, что нашли ворота и ревьюер, что переделано и почему.
- Честность в TIMELINE.md: конфиг v3 был у нас с самого начала, это нужно прямо написать. Ценность второй итерации в том, что код под v3 не подгонялся заранее и v3 опубликован на работающий прод без изменения схемы. Не выдумывать время «получения» конфига.

**Подготовка человека к разговору о коде**
Человек отвечает за реализацию, хотя не пишет код, поэтому в Фазе 8 создай `docs/EXPLAIN.md` на русском, не длиннее двух страниц: архитектура одной схемой, где лежит каждый источник правды, как проходит запрос «ответ → событие → дашборд», почему SQLite, как работают закрепление версии, дедупликация и откат, 10 вероятных вопросов проверяющих с короткими ответами.

---

## 15. README и документация (раздел 9 задания)

### 15.1. README: содержание и оформление

README — первое, что откроет проверяющий, и витрина всей работы. Язык — русский (как в задании), имена кода, команд и событий — как в коде. Оформление рассчитано на рендер GitHub: только то, что GitHub показывает корректно (markdown, таблицы, mermaid, `<details>`, `<picture>`, `<img>` с шириной). Без эмодзи-гирлянд и без маркетинговой воды: каждое предложение несёт факт.

**Визуальные материалы генерируются автоматически, а не вручную.** Команда `pnpm screenshots` (Playwright, Фаза 8) поднимает приложение на чистой базе, запускает генератор, проходит воронку и сохраняет PNG в `docs/images/`: дашборд, Funnel journey с открытым поповером шага, Versions с diff перед публикацией, Live events с дублями, вопрос воронки, результат. Десктоп 1440px, для воронки ещё мобильный 390px. Плюс короткая анимация (GIF или WebP до 3 МБ) прохождения воронки: выбор ответа, Continue, результат. Скриншоты коммитятся и пересоздаются той же командой после изменений.

**Структура README, сверху вниз:**
1. **Шапка.** Название, одна строка о том, что это, бейдж статуса CI из GitHub Actions. Под ней строка ссылок: «Открыть воронку · Админка · Репозиторий» и демо-логин админки в `code`.
2. **Hero-скриншот** дашборда во всю ширину, под ним два скриншота воронки рядом (вопрос и результат) через таблицу или `<p align="center">` с `<img width>`.
3. **«Проверить за 5 минут».** Нумерованный список действий для проверяющего с прямыми ссылками: пройти воронку, refresh посередине, открыть с `?variant=B`, включить `?debug=1`, в админке опубликовать и откатить версию, посмотреть Live events, сверить дашборд с генератором. Каждый пункт — что сделать и что должно получиться.
4. **Соответствие заданию.** Компактная таблица: пункт задания → где реализован → чем проверен (кратко, полная версия в `docs/REQUIREMENTS.md`).
5. **Архитектура.** Mermaid-схема (`flowchart LR`): браузер → API → SQLite, общий пакет `@funnel/shared`, используемый клиентом, сервером и генератором; абзац о единых источниках правды; ссылка на `docs/ARCHITECTURE.md`.
6. **Как это работает.** Три mermaid-схемы `sequenceDiagram` по 6–10 шагов: создание сессии с закреплением версии и варианта; отправка пачки событий с дедупликацией и повтором после таймаута; публикация и откат версии при живых старых сессиях.
7. **A/B-эксперимент.** Гипотеза, основная метрика, вторичные и guardrails — коротко, ссылка на `docs/EXPERIMENT.md`.
8. **Модель данных, события и агрегация.** По 2–3 предложения и ссылки на `docs/DATA_MODEL.md` (с ER-схемой mermaid `erDiagram`), `docs/EVENTS.md`, `docs/ANALYTICS.md`.
9. **Локальный запуск.** Требования и блок команд, который копируется целиком: `pnpm i`, `pnpm seed`, `pnpm dev`, `pnpm generate --publish-next`, `pnpm verify`, `pnpm test`, `pnpm e2e`. Отдельно — генератор против публичного URL (`--base-url`, `GENERATOR_KEY`) и таблица переменных окружения.
10. **Качество.** Что гарантирует `pnpm check`: строгий TypeScript, границы слоёв, отсутствие мёртвого кода и копипасты, пороги покрытия, e2e. Одной таблицей.
11. **Таймлайн.** Две итерации в виде mermaid `timeline` или таблицы с реальным временем из TIMELINE.md.
12. **Работа с агентами.** Как была декомпозирована задача (ссылки на milestones и закрытые PR), что шло параллельно, что нашли ревьюер и ворота качества (из AGENT_LOG.md), честно.
13. **Ограничения и допущения.** Список из LIMITATIONS.md.
14. **Структура репозитория.** Свёрнуто в `<details>`.

Все длинные блоки (переменные окружения, полный список команд, структура) — в `<details>`, чтобы README читался за пару минут сверху вниз. Перед сдачей открыть README на GitHub и убедиться, что все картинки, mermaid-схемы и ссылки отображаются.

### 15.2. Остальные документы

`docs/EXPERIMENT.md`, черновик гипотезы (уточнить формулировки, не менять суть):

> **Гипотеза.** Вариант B начинает с простых категориальных вопросов (как работает команда, насколько разнесены часовые пояса) и откладывает числовые вопросы, требующие подсчёта. Результат в B сформулирован как конкретная проблема команды, а CTA обещает план на 30 дней. Мы ожидаем, что меньшая когнитивная нагрузка в начале снизит ранний отвал, а конкретная формулировка результата повысит клики по CTA.
>
> **Основная метрика:** доля сессий, нажавших основную CTA, от всех начавших (started → CTA), по уникальным сессиям.
> **Вторичные:** result rate, CTR CTA от увидевших результат, отвал на первых двух вопросах.
> **Guardrails:** доля сессий с возвратами назад, распределение результатов (B не должен смещать рекомендации).
> **Ограничения:** A/B сравнивается только внутри одной версии, так как `experiment.id` у версий разный. На синтетических данных эффект заложен генератором и демонстрирует работу расчёта, а не реальный продуктовый вывод. Решение о победителе — только при p < 0.05 и достаточной выборке.

`docs/LIMITATIONS.md` (минимум): агрегатор в памяти, SQLite с одним писателем, Basic Auth вместо полноценной авторизации, override только при создании сессии, сессии на откатанной версии доживают на ней, нет миграции «живых» сессий между версиями, время клиента не доверенное, хостинг с одним инстансом, порог «in progress» 30 минут, `furthestIndex` считает отвал по самому дальнему шагу даже после возврата назад.

---

## 16. Сверка с заданием (чек-лист перед сдачей)

Перед тегом `iteration-1` и перед сдачей пройди по таблице и отметь, где это реализовано и чем проверено. Итоговую таблицу положи в `docs/REQUIREMENTS.md` и сошлись на неё из README.

| Пункт задания | Где в спецификации | Чем проверяется |
|---|---|---|
| 1. Экраны только из JSON, 5 типов, ветвление, валидация, результат и CTA | 4, 8.2 | тесты движка, ручной проход |
| 1. Прогресс по доступным шагам | 4.4 | тест progress |
| 1. Back, refresh, повторное открытие не теряют состояние | 8.1, 7.4 | ручная проверка, e2e по желанию |
| 2. Публикация без передеплоя, активная версия, откат | 6.1, 11.1 | тест 4, demo:iteration2 |
| 2. Версия закреплена, старые сессии на старой, новые только на активной | 6.2 | тесты 1 и «preview не создаёт сессий» |
| 3. A/B внутри версии, назначение на сервере, стабильность, override | 6.2 | тест 2 |
| 3. Вариант меняет тексты, порядок, результат | 4.3 | тест resolve |
| 3. Все события содержат версию и вариант | 7.3 | тест ingest (обогащение из сессии) |
| 3. Гипотеза и метрика в README | 15 | вычитка |
| 4. Endpoint, 7 событий, поля 4.1 | 7 | тест 3 |
| 4.2. Идемпотентность, батчи, повтор после таймаута, битое событие, приватность | 7.2–7.4 | тест 3 |
| 4.2. SQLite | 5 | — |
| 5. Метрики по уникальным сессиям, A/B, версии, фильтр по utm_campaign | 11.2 | тест 5, verify |
| 5. Повторы, back, дубли, порядок | 11.2 | тест 5, генератор |
| 6. Генератор: ≥100 сессий, UTM, A/B, ветки, отвалы, дубли, повтор пачки, порядок | 9 | verify |
| 7. TS, React, Node, один репозиторий, SQLite, публичный URL, без сторонних сервисов | 2 | вычитка, деплой |
| 7.1. Пять обязательных тестов | 12 | `pnpm test` |
| 8. v3: новая ветка, экран удалён у B, новое событие, старые сессии работают, publish → check → rollback без изменения схемы и без потери аналитики | 13 (Фаза 7) | demo:iteration2, тест схемы, тест совместимости |
| 9. URL, репозиторий, README, модель данных, event schema, агрегация, гипотеза, таймлайн, ограничения | 15 | README открыт на GitHub, картинки и схемы отображаются |
| 10. Работа с агентами | 13.1, 14 | milestones, issues и PR в GitHub, ревью-комментарии `reviewer`, AGENT_LOG.md, хуки, CI |
| Качество кода (сверх задания) | 3.1 | `pnpm check` в CI: границы, knip, jscpd, покрытие |

## 17. Чего не делать

- Не хардкодить экраны, вопросы, опции, тексты результатов.
- Не брать версию/вариант/UTM из клиентских событий как правду.
- Не класть значения ответов в события, логи и аналитические ответы API.
- Не удалять и не изменять версии и события. Откат — это новая строка активации.
- Не считать метрики по количеству событий.
- Не публиковать и не подгонять код под v3 до Фазы 7.
- Не добавлять внешние сервисы: CDN-аналитику, внешние БД, Google Fonts и другие CDN.
- Не создавать сессии на неактивных версиях, в том числе для предпросмотра.
- Не тратить время на визуальный редактор конфигов.
- Не дублировать типы, схемы, правила и стили: если нужно второй раз — вынести в `shared` или `ui` (3.1).
- Не поднимать пороги качества и не отключать правила линтера, чтобы пройти проверку. Исключение — только с записью в DECISIONS.md и причиной.
