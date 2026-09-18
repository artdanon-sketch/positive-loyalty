/**
 * Защита демо-полигона от боевой базы.
 *
 * ЗАЧЕМ. Seed заводит три демо-заведения с сотрудниками и печатает их PIN-коды
 * на экран. В локальной базе это удобно; в боевой — это чужие заведения
 * с известными паролями, то есть открытая дверь. Строка подключения в `.env`
 * легко оказывается удалённой: её копируют из панели Supabase, чтобы «просто
 * посмотреть», и забывают вернуть.
 *
 * ПРАВИЛО ПРОСТОЕ: в локальную базу — всегда, в удалённую — только с явным
 * `SEED_ALLOW_REMOTE=да`. Разрешение не записывается в `.env` по умолчанию:
 * его ставят руками на один запуск, понимая, куда пишут.
 *
 * Чистая функция без базы: её можно проверить тестом, не поднимая ничего.
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', 'postgres', 'db'])

export type SeedTarget =
  { readonly allowed: true } | { readonly allowed: false; readonly reason: string }

/** Хост из строки подключения, без пароля и прочего. */
export const databaseHost = (url: string): string | null => {
  try {
    return new URL(url).hostname
  } catch {
    return null
  }
}

export const seedTarget = (
  url: string | undefined,
  allowRemote: string | undefined,
): SeedTarget => {
  if (url === undefined || url.trim() === '') {
    return { allowed: false, reason: 'DATABASE_URL не задан — писать некуда.' }
  }

  const host = databaseHost(url)

  if (host === null) {
    return { allowed: false, reason: 'DATABASE_URL не разбирается как адрес базы.' }
  }

  if (LOCAL_HOSTS.has(host)) {
    return { allowed: true }
  }

  if (allowRemote?.trim().toLowerCase() === 'да' || allowRemote?.trim() === '1') {
    return { allowed: true }
  }

  return {
    allowed: false,
    reason:
      `База ${host} — не локальная. Демо-полигон заводит заведения с известными ` +
      'PIN-кодами, и в боевой базе это открытая дверь. Если база точно не боевая, ' +
      'запустите с SEED_ALLOW_REMOTE=да на один раз.',
  }
}
