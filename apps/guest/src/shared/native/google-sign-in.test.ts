import { afterEach, describe, expect, it, vi } from 'vitest'

import { isNativeGoogleAvailable, NativeGoogleError, signInWithNativeGoogle } from './google-sign-in'

type Win = { Capacitor?: unknown }

const setBridge = (signIn: (o: { serverClientId: string }) => Promise<unknown>): void => {
  ;(window as unknown as Win).Capacitor = {
    isPluginAvailable: (name: string) => name === 'GoogleSignIn',
    Plugins: { GoogleSignIn: { signIn } },
  }
}

afterEach(() => {
  delete (window as unknown as Win).Capacitor
})

describe('родной вход Google', () => {
  it('без оболочки (сайт или старый APK) — недоступен', () => {
    expect(isNativeGoogleAvailable()).toBe(false)
  })

  it('отдаёт токен и передаёт веб-клиент как serverClientId', async () => {
    const signIn = vi.fn(() => Promise.resolve({ idToken: 'tok' }))
    setBridge(signIn)
    expect(isNativeGoogleAvailable()).toBe(true)
    await expect(signInWithNativeGoogle('web-client')).resolves.toBe('tok')
    expect(signIn).toHaveBeenCalledWith({ serverClientId: 'web-client' })
  })

  it.each([
    ['CANCELED', 'canceled'],
    ['NO_CREDENTIAL', 'no-account'],
    ['FAILED', 'failed'],
    [undefined, 'failed'],
  ])('код %s → %s', async (code, reason) => {
    setBridge(() => Promise.reject(Object.assign(new Error('x'), { code })))
    const error = await signInWithNativeGoogle('c').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(NativeGoogleError)
    expect((error as NativeGoogleError).reason).toBe(reason)
  })

  it('пустой токен — отказ', async () => {
    setBridge(() => Promise.resolve({}))
    await expect(signInWithNativeGoogle('c')).rejects.toMatchObject({ reason: 'failed' })
  })
})
