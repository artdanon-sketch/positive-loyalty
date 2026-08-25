# POSitive Loyalty

Программа лояльности для малого бизнеса Пхукета. Часть семьи POSitive вместе с POSitive POS.

## Статус

Каркас монорепо поднят: pnpm workspaces, TypeScript strict, ESLint, Prettier, vitest, GitHub Actions.
Приложения пока пустые — health-check на API и по одному экрану-заглушке на фронтах. Бизнес-логики нет.

Дальше по `docs/06_Процесс_и_дорожная_карта.md`, раздел 8: Задача 2 — ledger с идемпотентностью,
Задача 3 — изоляция тенантов.

**Деплой ещё не подключён.** Workflow-заготовки лежат в `.github/workflows/`, имена проектов
Railway и Cloudflare в них — плейсхолдеры. Пока нет секретов, workflow проходят зелёными и ничего
не делают. Подробности ниже, в разделе «Окружения и деплой».

## Стек

NestJS 10 · TypeScript strict · Prisma · PostgreSQL (Supabase) · Redis (Upstash) · BullMQ
React 18 · Vite · TanStack Query · zod
Монорепо на pnpm workspaces. API на Railway, фронты на Cloudflare Pages.

## Документация

| Файл | О чём |
|---|---|
| `CLAUDE.md` | Правила репозитория. Читается перед каждой задачей |
| `docs/00_README.md` | Обзор пакета, контекст, ключевые решения |
| `docs/01_Архитектура_и_данные.md` | Топология, связь с POSitive POS, Prisma-схема, ledger |
| `docs/02_API_контракты.md` | Эндпоинты с примерами, вебхуки, коды ошибок |
| `docs/03_Бэк-офис_экраны.md` | Экраны бэк-офиса: зачем, что, откуда данные |
| `docs/04_Дизайн-система.md` | Токены, типографика, движение, компоненты |
| `docs/05_Безопасность_и_антифрод.md` | Модель угроз, OWASP, целостность денег, PDPA |
| `docs/06_Процесс_и_дорожная_карта.md` | Процесс, тесты, CI/CD, пять срезов, метрики |
| `docs/prototypes/` | HTML-прототипы интерфейсов, визуальный референс |

## Требования

| Что | Версия | Зачем именно эта |
|---|---|---|
| Node.js | **22.20.0** — точная версия в `.nvmrc`, ниже 22.13 не поднимется (`engines`) | LTS, ту же версию ставит CI из `.nvmrc` |
| pnpm | **11.23.0** | закреплён полем `packageManager` |
| Docker | любой свежий | локальные PostgreSQL и Redis |

pnpm ставится одной командой, версию подтянет сам из `package.json`:

```bash
corepack enable
corepack prepare --activate
```

Если пользуетесь nvm — `nvm use` подхватит версию из `.nvmrc`.

## Быстрый старт

```bash
git clone <репозиторий> && cd positive-loyalty

cp .env.example .env          # значения по умолчанию совпадают с docker-compose
docker compose up -d          # postgres:5432 и redis:6379 на 127.0.0.1
pnpm install
pnpm dev                      # api + admin + guest параллельно
```

Что должно подняться:

| Что | Где |
|---|---|
| API | http://localhost:3000 · health-check на `/health` |
| Бэк-офис (admin) | http://localhost:5173 |
| Гостевое приложение (guest) | http://localhost:5174 |

Проверить, что каркас цел, до всякой разработки:

```bash
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build
```

Это всё, что из CI воспроизводится локально. Один шаг остаётся только в CI — **gitleaks**:
он запускается экшеном и сканирует историю коммитов, локального аналога у нас нет.
Так что зелёная строчка выше означает «по коду вопросов нет», но не «PR точно позеленеет»:
секрет, случайно попавший в коммит, найдётся уже на CI.

## Команды

### Разработка

| Команда | Что делает |
|---|---|
| `pnpm dev` | собирает `contracts` и `ui`, затем поднимает api, admin и guest параллельно |
| `pnpm dev:api` | только API |
| `pnpm dev:worker` | только фоновый воркер BullMQ |
| `pnpm dev:admin` | только бэк-офис |
| `pnpm dev:guest` | только гостевое приложение |

### Проверки

| Команда | Что делает |
|---|---|
| `pnpm lint` | ESLint по всему монорепо (конфиг один, корневой) |
| `pnpm lint:fix` | то же с автопочинкой |
| `pnpm typecheck` | `tsc --noEmit` во всех пакетах, strict |
| `pnpm test` | vitest во всех пакетах |
| `pnpm test:e2e` | e2e-тесты API (supertest поверх поднятого Nest-приложения) |
| `pnpm format` | Prettier: чинит форматирование на месте |
| `pnpm format:check` | Prettier: только проверяет. Ровно этот шаг гоняет CI |

### Сборка

| Команда | Что делает |
|---|---|
| `pnpm build:packages` | собирает `@positive/contracts` и `@positive/ui` в `dist` |
| `pnpm build` | собирает всё |
| `pnpm clean` | сносит `dist`, `coverage`, кэши |

`build:packages` вызывается автоматически перед `dev`, `lint`, `typecheck` и `test`.
Приложения потребляют **собранный `dist`** пакетов, а не исходники — иначе `tsc` в `apps/api`
упирается в `rootDir`.

### Локальная инфраструктура

| Команда | Что делает |
|---|---|
| `docker compose up -d` | поднять PostgreSQL 16 и Redis 7 |
| `docker compose ps` | проверить healthcheck |
| `docker compose logs -f postgres` | логи базы |
| `docker compose down` | остановить, данные в томах сохранятся |
| `docker compose down -v` | остановить и стереть данные |

Команды базы — `pnpm db:migrate`, `pnpm db:seed`, `pnpm db:studio` — появятся вместе с Prisma
в Задаче 2.

## Структура

```
apps/
  api/           NestJS: REST, вебхуки, ledger, правила
  worker/        фоновые задачи BullMQ: рассылки, сгорание, ночная сверка
  admin/         бэк-офис заведения (React + Vite)
  guest/         гостевое PWA (React + Vite)
packages/
  contracts/     zod-схемы запросов и ответов, общие типы
  ui/            дизайн-токены и компоненты
  config/        общие пресеты tsconfig и prettier
eslint.config.mjs  единственный конфиг линтера на весь монорепо
docs/            ТЗ и HTML-прототипы
.github/         CI и заготовки деплоя
```

Скоуп пакетов — `@positive/*`. Внутренние зависимости объявляются как `"workspace:*"`.
Раскладка внутри `apps/api/src` и `apps/admin/src` описана в `CLAUDE.md`.

Файлы — `kebab-case`, компоненты — `PascalCase`, функции — `camelCase`. Один компонент — один файл.

## CI

`.github/workflows/ci.yml`, один job `check` на каждый pull request и на push в `main`:

```
pnpm install --frozen-lockfile
  → pnpm lint
  → pnpm format:check
  → pnpm typecheck
  → gitleaks
  → pnpm test
  → pnpm build
```

Порядок не случайный: дешёвые проверки первыми. Новый пуш в ветку отменяет предыдущий прогон.

**gitleaks.** Сканер секретов, требование `docs/05_Безопасность_и_антифрод.md`, раздел 9.
Правила и allowlist — в `.gitleaks.toml`. Для **личного** репозитория экшен работает бесплатно.
Если репозиторий переедет **в организацию GitHub**, экшену обязателен ключ `GITLEAKS_LICENSE`
в Secrets — без него шаг падает.

Сейчас сканер работает **только в CI**. Pre-commit-хука в репозитории нет: ни `husky`, ни
`lefthook`, ни `prepare`-скрипта. ТЗ хочет сканер и до коммита тоже, но любой из вариантов —
это новая зависимость и общий git-хук на всю команду, поэтому вопрос открыт и решается
с владельцем репозитория отдельно. Практическое следствие: секрет ловится на PR, а не в момент
`git commit`, — и вычищать его придётся уже из истории ветки.

## Окружения и деплой

| Среда | API | Фронты | База | Триггер |
|---|---|---|---|---|
| **local** | localhost:3000 | localhost:5173 / 5174 | docker postgres | `pnpm dev` |
| **preview** | Railway PR-окружение | Cloudflare preview на ветку | ветка Supabase | открытие PR |
| **staging** | `api-staging.*` | `staging.*` | отдельный проект Supabase | зелёный CI на `main` |
| **production** | `api.*` | `app.*` / `my.*` | продовый Supabase | тег `v*` + ручное подтверждение |

Домены — гипотеза из ТЗ: `api.loyalty.positive.app`, `biz.loyalty.positive.app` (бэк-офис),
`my.positive.app` (гость). Короткий домен гостя важен: он печатается на табличках.

### Чего ещё нет

Проекты Railway и Cloudflare **не созданы**. В заготовках workflow имена вынесены в блок `env`
вверху файла как плейсхолдеры — `positive-loyalty-api`, `positive-loyalty-worker`,
`positive-loyalty-admin`, `positive-loyalty-guest`. Их надо заменить на реальные.

Пока секретов нет, шаги деплоя пропускаются, и workflow заканчивается зелёным с пометкой в
summary. Это сделано намеренно: неподключённый деплой не должен красить PR в красный.

Гейтинг устроен так: контекст `secrets` недоступен в условии на уровне job, поэтому секрет
пробрасывается в `env` job'а, а проверка `if: env.RAILWAY_TOKEN != ''` стоит на уровне шага.

Staging выкатывается не по пушу в `main`, а по событию `workflow_run` от CI — и только при
`conclusion == 'success'`. Так красный прогон физически не может уехать в среду; при squash-merge
это важно вдвойне: коммит в `main` новый, PR-гейт его не проверял.

### Какие секреты понадобятся

Settings → Secrets and variables → Actions:

| Секрет | Где взять | Для чего |
|---|---|---|
| `RAILWAY_TOKEN` | Railway → Account Settings → Tokens (**аккаунтный**, не project-token) | деплой `api` и `worker` |
| `RAILWAY_PROJECT_ID` | Railway → Project Settings → General, поле Project ID | тот же деплой: аккаунтный токен сам проект не выбирает |
| `CLOUDFLARE_API_TOKEN` | Cloudflare → My Profile → API Tokens, права Cloudflare Pages: Edit | деплой `admin` и `guest` |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare → Overview, правая колонка | тот же деплой |
| `GITLEAKS_LICENSE` | gitleaks.io | **только** если репозиторий в организации |

Токен именно аккаунтный: project-token привязан к паре проект + окружение, а превью деплоится
в динамическое `pr-N`, поэтому одним секретом три workflow он бы не обслужил. Расплата за это —
проект приходится указывать явно: перед `railway up` workflow делает
`railway link --project "$RAILWAY_PROJECT_ID" --environment ... --service ...`, иначе на чистом
раннере команда падает с ошибкой о непривязанном проекте.

Для production дополнительно: создать environment `production` (Settings → Environments),
включить **Required reviewers** — именно это даёт ручное подтверждение выкатки, сам по себе
`environment` его не даёт, — и привязать к нему продовые значения.

Значения приложений (`DATABASE_URL`, `REDIS_URL`, ключи подписи) в GitHub Secrets **не кладём**.
Они живут в Railway env, Cloudflare env и Supabase Vault. В репозитории — только `.env.example`
без значений.

### Порядок выкатки

Миграции применяются **отдельным шагом до деплоя кода** и должны быть обратимо совместимы:
иначе откат кода при живой миграции ломает прод. Отсюда правило из `CLAUDE.md` — колонку не
удаляем в одном релизе с кодом, который перестал её использовать; между ними минимум один деплой.
Шаг с миграциями размечен в `deploy-staging.yml` и `deploy-production.yml` и включится в Задаче 2,
когда появится Prisma.

## Как мы работаем

Trunk-based. `main` всегда деплоится, ветки живут меньше двух дней, мержим squash.
Каждый PR: что и зачем, ссылка на раздел ТЗ, «готово когда», скриншот для UI, зелёный CI.
Шаблон подставляется автоматически из `.github/pull_request_template.md`.

Неготовая функциональность едет в `main` выключенной за фича-флагом, а не живёт в длинной ветке.

Перед задачей читайте `CLAUDE.md` и соответствующий раздел ТЗ. Если задача противоречит ТЗ —
это повод остановиться и обсудить, а не молча сделать по-своему.
