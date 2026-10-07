/**
 * Подготовка окружения интеграционных тестов ledger.
 *
 * Файл подключён как `setupFiles` в `vitest.integration.config.mts` и выполняется
 * в каждом воркере ДО импорта спеков — то есть до того, как будет создан PrismaService.
 *
 * Зачем он нужен.
 *
 * 1. ОТДЕЛЬНАЯ БАЗА, а не «та же, но осторожно». Тесты пишут в журнал строки, которые
 *    невозможно удалить: UPDATE, DELETE и TRUNCATE на `LedgerEntry` запрещены триггером
 *    (миграция `init_ledger_core`). Прогон по базе разработки засорил бы её навсегда,
 *    а прогон по боевой — это инцидент. Поэтому строка подключения приходит из ОТДЕЛЬНОЙ
 *    переменной `DATABASE_URL_TEST`, и совпадение её с `DATABASE_URL` считается ошибкой
 *    конфигурации, а не мелочью.
 *
 * 2. НИКАКИХ ХАРДКОДОВ. Ни в одном тесте нет строки подключения: единственное место,
 *    где она читается, — здесь.
 *
 * 3. `PrismaService` читает `process.env.DATABASE_URL` в конструкторе и другого входа
 *    для строки подключения не имеет. Подменяем переменную процесса — это позволяет
 *    тестировать НАСТОЯЩИЙ провайдер приложения, а не его копию с другим конструктором.
 *    Копия рано или поздно разъехалась бы с оригиналом, и тесты проверяли бы не то,
 *    что работает в проде.
 */
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

/** Строка подключения к ТЕСТОВОЙ базе. Намеренно отдельная переменная. */
const TEST_URL_VAR = 'DATABASE_URL_TEST'

/** Строка подключения приложения. Тесты её только читают — чтобы сравнить и отказаться. */
const RUNTIME_URL_VAR = 'DATABASE_URL'

/** Роль панели платформы. Её значение из .env в тестах не живёт ни секунды. */
const PLATFORM_URL_VAR = 'DATABASE_URL_PLATFORM'

/** Тестовая роль платформы — её же читают два теста панели платформы. */
const TEST_PLATFORM_URL_VAR = 'DATABASE_URL_TEST_PLATFORM_ROLE'

/**
 * На сколько уровней вверх от текущего каталога искать `.env`.
 * Тесты запускаются из `apps/api`, корень монорепо — на два уровня выше; берём с запасом.
 */
const ENV_LOOKUP_DEPTH = 4

const readVar = (name: string): string | undefined => {
  const raw = process.env[name]?.trim()
  return raw === undefined || raw.length === 0 ? undefined : raw
}

/**
 * Подгружает `.env` от текущего каталога вверх до корня монорепо.
 *
 * Порядок «ближний файл раньше дальнего» важен: `process.loadEnvFile` НЕ перетирает
 * уже заданные ключи (проверено на Node 22.20 — значение из шелла выигрывает у файла),
 * поэтому первым выигрывает тот, кого загрузили раньше. Отсюда два следствия, оба нужные:
 * переменная из шелла всегда старше любого файла, а `apps/api/.env` — старше корневого.
 */
const loadEnvFiles = (): void => {
  let directory = process.cwd()

  for (let level = 0; level <= ENV_LOOKUP_DEPTH; level += 1) {
    const file = resolve(directory, '.env')

    if (existsSync(file)) {
      process.loadEnvFile(file)
    }

    const parent = dirname(directory)

    if (parent === directory) {
      return
    }

    directory = parent
  }
}

/**
 * Инструкция вместо «connect ECONNREFUSED»: тот, кто увидит ошибку, должен знать,
 * что делать, не открывая исходники. Экспортируется — её же показывает проверка
 * готовности схемы в ledger-test-context.ts.
 */
export const TEST_DATABASE_HOWTO = [
  `Интеграционные тесты ledger работают с НАСТОЯЩИМ PostgreSQL и требуют ${TEST_URL_VAR}.`,
  '',
  'Что сделать:',
  '  1. Завести отдельную базу — не ту, на которой ведётся разработка:',
  '       createdb positive_loyalty_test',
  `  2. Прописать ${TEST_URL_VAR} в .env (корневой или apps/api) либо в окружение:`,
  `       ${TEST_URL_VAR}=postgresql://<user>:<password>@localhost:5432/positive_loyalty_test?schema=public`,
  '  3. Накатить на неё миграции. Значение из шелла старше .env (prisma.config.ts',
  '     читает файл через loadEnvFile, а он не перетирает уже заданные переменные),',
  '     поэтому подмена на один вызов попадает именно в тестовую базу:',
  '       bash:       DATABASE_URL="$DATABASE_URL_TEST" pnpm db:deploy',
  '       PowerShell: $env:DATABASE_URL=$env:DATABASE_URL_TEST; pnpm db:deploy;',
  '                   Remove-Item Env:DATABASE_URL',
  '  4. Запустить тесты из корня репозитория:',
  '       pnpm --filter @positive/api run test:integration',
  '',
  'Обычный `pnpm test` эти тесты не запускает: базы в CI нет, и это сознательно.',
].join('\n')

const applyTestDatabaseUrl = (): void => {
  loadEnvFiles()

  const testUrl = readVar(TEST_URL_VAR)

  if (testUrl === undefined) {
    throw new Error(`${TEST_URL_VAR} не задан.\n\n${TEST_DATABASE_HOWTO}`)
  }

  const runtimeUrl = readVar(RUNTIME_URL_VAR)

  // Значения в сообщение не попадают: в строке подключения лежит пароль (docs/05, раздел 10).
  if (runtimeUrl !== undefined && runtimeUrl === testUrl) {
    throw new Error(
      `${TEST_URL_VAR} совпадает с ${RUNTIME_URL_VAR}. Интеграционные тесты пишут в журнал ` +
        'строки, которые нельзя удалить (LedgerEntry append-only), и рабочая база после ' +
        'прогона останется с мусорными операциями навсегда. Заведите отдельную базу.',
    )
  }

  process.env[RUNTIME_URL_VAR] = testUrl

  // РОЛЬ ПЛАТФОРМЫ — ТА ЖЕ БЕДА, ЧТО С DATABASE_URL, ТОЛЬКО ТИШЕ.
  //
  // `PlatformPrismaService` ходит не по DATABASE_URL, а по DATABASE_URL_PLATFORM,
  // и запасного варианта у него нет. Почти каждый интеграционный тест поднимает
  // AppModule целиком — а с ним и сервис платформы. У разработчика в .env эта
  // переменная смотрит в БОЕВУЮ базу (там она нужна панели платформы), и без
  // подмены здесь каждый прогон открывал бы подключение к живым данным под ролью,
  // которая видит все заведения. В CI это не всплывало только потому, что там
  // нет .env — а значит, однажды всплыло бы на чужой машине.
  //
  // Подменяем ВСЕГДА, а не «если задана тестовая»: оставить значение из .env —
  // единственный исход, которого быть не должно. Нет тестовой роли — берём
  // тестовую базу целиком: двум тестам панели платформы этого мало, и они
  // откажутся сами со своей инструкцией, а остальным сервис платформы не нужен.
  process.env[PLATFORM_URL_VAR] = readVar(TEST_PLATFORM_URL_VAR) ?? testUrl
}

applyTestDatabaseUrl()
