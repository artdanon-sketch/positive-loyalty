/**
 * Не даёт выполнить разрушительную команду Prisma на неместной базе.
 *
 * ЗАЧЕМ. `prisma migrate reset` сносит схему и накатывает её заново. Пока база
 * была своя и одноразовая, худшим исходом были потерянные демо-данные. Как
 * только база становится ОБЩЕЙ с другим продуктом — а именно это происходит,
 * когда лояльность въезжает в чужой проект Supabase, — цена ошибки меняется
 * полностью: рядом, в соседней схеме, живёт чужой сайт.
 *
 * Проверка намеренно ГРУБАЯ: разрешён только локальный хост. Тонкая эвристика
 * («это же staging») тут вредна — ошибиться в ней можно ровно один раз.
 *
 * Обойти можно осознанно: I_KNOW_THIS_IS_NOT_LOCAL=yes. Переменная длинная
 * и неудобная именно потому, что набирать её должно быть неприятно.
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '0.0.0.0', 'host.docker.internal'])

const OVERRIDE = 'I_KNOW_THIS_IS_NOT_LOCAL'

const url = process.env.DATABASE_URL

if (url === undefined || url.trim() === '') {
  process.stderr.write('DATABASE_URL не задан — выполнять разрушительную команду не по чему.\n')
  process.exit(1)
}

let host
try {
  host = new URL(url).hostname
} catch {
  process.stderr.write('DATABASE_URL не разбирается как URL. Проверьте .env\n')
  process.exit(1)
}

if (LOCAL_HOSTS.has(host)) {
  process.exit(0)
}

if (process.env[OVERRIDE] === 'yes') {
  process.stderr.write(
    [
      `⚠ База ${host} НЕ локальная, но выполнение разрешено через ${OVERRIDE}=yes.`,
      '  Если на этой базе живёт что-то ещё — остановитесь.',
      '',
    ].join('\n'),
  )
  process.exit(0)
}

process.stderr.write(
  [
    '',
    `ОТКАЗАНО: база ${host} не локальная.`,
    '',
    'Эта команда сносит схему и накатывает её заново. На общей базе рядом',
    'может жить другой продукт — например сайт в схеме public.',
    '',
    'Что делать вместо этого:',
    '  • накатить недостающие миграции  →  pnpm db:deploy',
    '  • посмотреть состояние           →  npx prisma migrate status',
    '',
    `Если вы точно знаете, что база одноразовая: ${OVERRIDE}=yes pnpm db:reset`,
    '',
  ].join('\n'),
)

process.exit(1)
