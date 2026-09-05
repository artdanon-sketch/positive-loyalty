/**
 * Не даёт выполнить разрушительную команду на неместной базе.
 *
 * ЗАЧЕМ. Пока база была своя и одноразовая, худшим исходом были потерянные
 * демо-данные. Как только база становится ОБЩЕЙ с другим продуктом — а именно
 * это происходит, когда лояльность въезжает в чужой проект Supabase, — цена
 * ошибки меняется полностью: рядом, в соседней схеме, живёт чужой сайт.
 *
 * ЧТО ИМЕННО ЗАЩИЩАЕТСЯ:
 *   • db:reset  — сносит схему и накатывает её заново;
 *   • db:seed   — заливает 200 выдуманных гостей и 90 дней выдуманных операций;
 *   • demo:sales — то же самое, но ещё и проводит операции по журналу.
 *
 * Про seed стоит сказать отдельно: он выглядит безобиднее reset, но journal
 * баллов append-only — вписанные им операции удалить потом НЕЛЬЗЯ. На боевой
 * базе это навсегда.
 *
 * Проверка намеренно ГРУБАЯ: разрешён только локальный хост. Тонкая эвристика
 * («это же staging») тут вредна — ошибиться в ней можно ровно один раз.
 *
 * Проверяются ОБЕ строки подключения: приложение ходит по DATABASE_URL,
 * а миграции — по DATABASE_URL_OWNER. Достаточно одной неместной, чтобы
 * отказать: команда может воспользоваться любой из них.
 *
 * Обойти можно осознанно: I_KNOW_THIS_IS_NOT_LOCAL=yes. Переменная длинная
 * и неудобная именно потому, что набирать её должно быть неприятно.
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', 'host.docker.internal'])

const OVERRIDE = 'I_KNOW_THIS_IS_NOT_LOCAL'

/** Что именно защищаем — попадает в текст отказа. */
const COMMAND = process.argv[2] ?? 'эта команда'

const WHAT_IT_DOES = {
  'db:reset': 'сносит схему целиком и накатывает её заново',
  'db:seed': 'заливает выдуманные данные, а операции журнала потом не удалить',
  'demo:sales': 'проводит выдуманные продажи по журналу баллов — навсегда',
}

const candidates = [
  ['DATABASE_URL', process.env.DATABASE_URL],
  ['DATABASE_URL_OWNER', process.env.DATABASE_URL_OWNER],
].filter(([, value]) => typeof value === 'string' && value.trim() !== '')

if (candidates.length === 0) {
  process.stderr.write('DATABASE_URL не задан — выполнять разрушительную команду не по чему.\n')
  process.exit(1)
}

const remote = []

for (const [name, value] of candidates) {
  let host
  try {
    host = new URL(value).hostname
  } catch {
    process.stderr.write(`${name} не разбирается как URL. Проверьте .env\n`)
    process.exit(1)
  }

  if (!LOCAL_HOSTS.has(host)) {
    remote.push(`${name} → ${host}`)
  }
}

if (remote.length === 0) {
  process.exit(0)
}

if (process.env[OVERRIDE] === 'yes') {
  process.stderr.write(
    [
      `⚠ База НЕ локальная, но выполнение разрешено через ${OVERRIDE}=yes.`,
      ...remote.map((r) => `    ${r}`),
      '  Если на этой базе живёт что-то ещё — остановитесь.',
      '',
    ].join('\n'),
  )
  process.exit(0)
}

process.stderr.write(
  [
    '',
    `ОТКАЗАНО: «${COMMAND}» смотрит на неместную базу.`,
    ...remote.map((r) => `    ${r}`),
    '',
    `Эта команда ${WHAT_IT_DOES[COMMAND] ?? 'меняет данные необратимо'}.`,
    'На общей базе рядом живёт другой продукт — например сайт в схеме public.',
    '',
    'Что делать вместо этого:',
    '  • накатить недостающие миграции  →  pnpm db:deploy',
    '  • посмотреть состояние           →  npx prisma migrate status',
    '',
    `Если вы точно знаете, что база одноразовая: ${OVERRIDE}=yes pnpm ${COMMAND}`,
    '',
  ].join('\n'),
)

process.exit(1)
