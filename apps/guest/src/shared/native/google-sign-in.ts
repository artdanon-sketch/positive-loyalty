/**
 * Родной вход Google в приложении «Карта гостя».
 *
 * Нативная половина — `apps/mobile/guest/android/.../GoogleSignInPlugin.java`.
 * Обращаемся через `window.Capacitor`, который оболочка кладёт в вебвью сама:
 * тащить `@capacitor/core` в веб-сборку ради одного вызова незачем (та же
 * логика, что в `shared/config/platform.ts`).
 *
 * Старый APK без модуля ответит «недоступно» — кнопки там просто не будет,
 * а не будет кнопки, которая падает.
 */

interface CapacitorBridge {
  readonly isPluginAvailable?: (name: string) => boolean
  readonly Plugins?: Record<string, unknown>
}

interface GoogleSignInPlugin {
  signIn: (options: { serverClientId: string }) => Promise<{ idToken?: string }>
}

const PLUGIN = 'GoogleSignIn'

const bridge = (): CapacitorBridge | undefined =>
  (window as unknown as { Capacitor?: CapacitorBridge }).Capacitor

export function isNativeGoogleAvailable(): boolean {
  try {
    return bridge()?.isPluginAvailable?.(PLUGIN) === true
  } catch {
    return false
  }
}

/** Почему не получилось. `canceled` — гость сам закрыл окно, сообщать нечего. */
export type NativeGoogleFailure = 'canceled' | 'no-account' | 'failed'

export class NativeGoogleError extends Error {
  constructor(
    readonly reason: NativeGoogleFailure,
    message: string,
  ) {
    super(message)
    this.name = 'NativeGoogleError'
  }
}

const reasonOf = (code: unknown): NativeGoogleFailure =>
  code === 'CANCELED' ? 'canceled' : code === 'NO_CREDENTIAL' ? 'no-account' : 'failed'

export async function signInWithNativeGoogle(serverClientId: string): Promise<string> {
  const plugin = bridge()?.Plugins?.[PLUGIN] as GoogleSignInPlugin | undefined
  if (plugin === undefined) {
    throw new NativeGoogleError('failed', 'Модуль входа Google не найден')
  }

  try {
    const result = await plugin.signIn({ serverClientId })
    if (typeof result.idToken !== 'string' || result.idToken === '') {
      throw new NativeGoogleError('failed', 'Google не вернул токен')
    }
    return result.idToken
  } catch (cause) {
    if (cause instanceof NativeGoogleError) {
      throw cause
    }
    const { code, message } = (cause ?? {}) as { code?: unknown; message?: unknown }
    throw new NativeGoogleError(reasonOf(code), typeof message === 'string' ? message : 'Google sign-in failed')
  }
}
