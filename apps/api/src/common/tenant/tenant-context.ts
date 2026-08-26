import { AsyncLocalStorage } from 'node:async_hooks'

import { TenantContextMissingError } from './tenant.errors'

/**
 * Контекст тенанта на время обработки запроса.
 *
 * Железное правило 2 из CLAUDE.md: `tenantId` берётся ТОЛЬКО отсюда, и попадает
 * сюда только из проверенного токена. Ни тело запроса, ни query, ни заголовок
 * источником быть не могут — иначе касса подставит чужой идентификатор и прочитает
 * чужие баллы.
 */
export interface TenantContextValue {
  /** Заведение, от имени которого идёт запрос. Всегда из JWT. */
  readonly tenantId: string
  /** Кто именно действует. Нужен ledger'у для actorId и аудиту. */
  readonly actorId: string | null
  /** Роль из токена. Проверку прав по ролям делает отдельный гвард. */
  readonly role: string | null
  /** Сквозная трассировка: тот же идентификатор уходит в логи и в X-Request-Id. */
  readonly requestId: string
}

/**
 * Почему AsyncLocalStorage, а не request-scoped провайдер NestJS.
 *
 * Request-scoped провайдер заставляет Nest пересоздавать всё дерево зависимостей
 * на каждый запрос, включая PrismaService с его пулом. ALS даёт то же самое
 * без перестройки графа и, главное, доступен из мест, куда DI не дотягивается —
 * из расширения Prisma, которое подставляет `tenantId` в запросы.
 */
const storage = new AsyncLocalStorage<TenantContextValue>()

export const TenantContext = {
  /**
   * Выполняет продолжение запроса внутри контекста.
   *
   * Именно `run`, а не `enterWith`: `run` замыкает контекст на переданную функцию
   * и гарантированно распространяется по всей асинхронной цепочке под ней.
   * `enterWith` меняет контекст текущего асинхронного ресурса и в связке
   * middleware → guard → interceptor → handler ведёт себя неочевидно.
   */
  run<T>(value: TenantContextValue, fn: () => T): T {
    return storage.run(value, fn)
  },

  /** Контекст или `undefined` — для мест, где его законно может не быть. */
  get(): TenantContextValue | undefined {
    return storage.getStore()
  },

  /**
   * Контекст или ошибка.
   *
   * Осознанно бросает, а не возвращает `undefined`: молчаливое отсутствие тенанта
   * в финансовой операции — это запись без владельца, и обнаружится она нескоро.
   */
  getOrThrow(): TenantContextValue {
    const value = storage.getStore()
    if (value === undefined) {
      throw new TenantContextMissingError()
    }
    return value
  },

  /** Только для тестов: прогнать код под конкретным тенантом. */
  runForTest<T>(value: TenantContextValue, fn: () => T): T {
    return storage.run(value, fn)
  },
} as const
