import { Script } from 'node:vm'

import { describe, expect, it } from 'vitest'

import { PlatformLoginController } from './platform-login.controller'

/**
 * Страница панели платформы.
 *
 * Скрипт страницы — строка внутри TypeScript: ни компилятор, ни линтер его
 * не читают. Одна пропущенная кавычка — и вход в панель молча перестаёт
 * работать, а узнаёт об этом владелец платформы, а не CI.
 */
describe('Страница панели платформы', () => {
  const page = new PlatformLoginController()

  it('СКРИПТ СТРАНИЦЫ — КОРРЕКТНЫЙ JAVASCRIPT', () => {
    // Компиляция без запуска: браузерных объектов здесь нет, а синтаксис проверяется.
    expect(() => new Script(page.script())).not.toThrow()
  })

  it('жалобы на спам: секция на экране и обе ручки разбора', () => {
    const script = page.script()

    expect(script).toContain("'/v1/platform/invite-complaints'")
    expect(script).toContain("'/review'")
    expect(script).toContain('id="complaints"')
  })

  it('без встроенных обработчиков: CSP процесса их не выполнит', () => {
    expect(page.script()).not.toMatch(/\bon(click|submit|change|load)\s*=/)
    expect(page.page()).toContain('<script src="/login.js"></script>')
  })
})
