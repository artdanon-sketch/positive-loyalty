import 'reflect-metadata'

import { createHash, randomBytes } from 'node:crypto'

import { hashPin } from '../auth/pin'

import { PlatformPrismaService } from './platform-prisma.service'
import { keyFromEnv, sealSecret } from './secret-box'
import { generateSecret, otpauthUrl } from './totp'

/**
 * Заведение ПЕРВОГО админа платформы.
 *
 * ─── ПОЧЕМУ ОТДЕЛЬНЫЙ СКРИПТ, А НЕ ЭКРАН И НЕ SEED ──────────────────────────
 *
 * Экрана быть не может: чтобы завести админа через панель, нужно в неё войти,
 * а войти некем. Классическая курица с яйцом, и решается она одинаково везде —
 * разовой командой, которую запускает администратор среды.
 *
 * И не seed: prisma/seed.ts обязан быть детерминированным (CLAUDE.md), то есть
 * пароль в нём был бы фиксированным. Фиксированный пароль у учётной записи,
 * видящей все заведения, — это не демо-данные, это дыра с расписанием.
 *
 * ─── ЧТО ВЫВОДИТСЯ И ПОЧЕМУ ОДИН РАЗ ────────────────────────────────────────
 *
 * Пароль, ссылка для QR-кода и коды восстановления печатаются в терминал
 * ЕДИНСТВЕННЫЙ раз и нигде не сохраняются. В базе от них остаются только
 * хеши и зашифрованный секрет — восстановить исходные значения оттуда нельзя
 * ни нам, ни тому, кто украдёт базу.
 *
 * Значит, потерять их на этом шаге означает завести админа заново. Это
 * неудобство сознательное: альтернатива — держать где-то копию, а всякая
 * копия учётных данных однажды утекает.
 *
 * ─── ЗАПУСК ─────────────────────────────────────────────────────────────────
 *
 *   pnpm --filter @positive/api build
 *   node apps/api/dist/platform/bootstrap-admin.js "почта@пример.рф" "Имя Фамилия"
 *
 * Нужны переменные DATABASE_URL_PLATFORM и PLATFORM_TOTP_ENC_KEY.
 */

/** Сколько кодов восстановления выдаём. Десять — стандартная практика. */
const RECOVERY_CODES = 10

/**
 * Пароль генерируем мы, а не человек.
 *
 * У этой учётной записи нет заведения, за которым можно спрятаться: она видит
 * всех сразу. Придуманный человеком пароль здесь — это либо что-то из словаря,
 * либо что-то, что он всё равно запишет. Пусть лучше будет случайным и сразу
 * уедет в менеджер паролей.
 */
const generatePassword = (): string => randomBytes(24).toString('base64url')

/**
 * Алфавит кодов восстановления.
 *
 * Без 0, O, 1, I и L: коды печатают на бумаге и вводят руками с неё, а эти
 * символы в большинстве шрифтов различаются хуже, чем хотелось бы человеку,
 * который уже потерял телефон и нервничает.
 */
const RECOVERY_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'

/**
 * Код восстановления: РОВНО двенадцать знаков, разбитых на 4-4-4.
 *
 * Ровно — не косметика. Сначала здесь бралась случайная строка base64url,
 * из неё вырезались «-» и «_», и остаток обрезался до двенадцати. Сколько
 * символов выпадет, зависело от случая: пробный запуск выдал коды из десяти
 * и одиннадцати знаков вперемешку с двенадцатью. То есть стойкость кода
 * тоже определялась случайностью, а не замыслом — на два знака короче
 * означает в тысячу раз меньше вариантов.
 *
 * Теперь символы берутся по одному из алфавита, и длина не зависит ни от чего.
 * Смещения выборки нет: длина алфавита 31, и байты, попавшие в неполный
 * последний диапазон, отбрасываются, а не сворачиваются остатком.
 */
const generateRecoveryCode = (): string => {
  const need = 12
  const out: string[] = []
  const limit = Math.floor(256 / RECOVERY_ALPHABET.length) * RECOVERY_ALPHABET.length

  while (out.length < need) {
    for (const byte of randomBytes(need)) {
      if (byte >= limit) {
        continue
      }

      out.push(RECOVERY_ALPHABET.charAt(byte % RECOVERY_ALPHABET.length))

      if (out.length === need) {
        break
      }
    }
  }

  const code = out.join('')
  return `${code.slice(0, 4)}-${code.slice(4, 8)}-${code.slice(8, 12)}`
}

const main = async (): Promise<void> => {
  const email = process.argv[2]?.trim().toLowerCase()
  const displayName = process.argv[3]?.trim()

  if (email === undefined || email === '' || displayName === undefined || displayName === '') {
    throw new Error(
      'Нужны два аргумента: почта и имя.\n' +
        '  node apps/api/dist/platform/bootstrap-admin.js "почта@пример.рф" "Имя Фамилия"',
    )
  }

  // Ключ шифрования проверяем ДО обращения к базе: узнать о его отсутствии
  // после создания половины записей было бы худшим из вариантов.
  const encKey = keyFromEnv(process.env['PLATFORM_TOTP_ENC_KEY'])

  const prisma = new PlatformPrismaService()
  await prisma.onModuleInit()

  try {
    const existing = await prisma.platformAdmin.findUnique({ where: { email } })

    if (existing !== null) {
      throw new Error(
        `Админ с почтой ${email} уже заведён. Скрипт намеренно не переписывает ` +
          'существующие учётные данные: молча сменить пароль администратору, ' +
          'который сейчас работает, — плохая идея.',
      )
    }

    const password = generatePassword()
    const secret = generateSecret()
    const recoveryCodes = Array.from({ length: RECOVERY_CODES }, generateRecoveryCode)

    const admin = await prisma.platformAdmin.create({
      data: {
        email,
        displayName,
        passwordHash: await hashPin(password),
        totpSecretEnc: sealSecret(secret, encKey),
        // Второй фактор НЕ подтверждён: вход будет отклоняться, пока владелец
        // не подключит аутентификатор и не подтвердит первым кодом. Иначе
        // учётка с ненастроенной 2FA впускала бы по одному лишь паролю.
        totpConfirmedAt: null,
        recoveryCodes: {
          create: recoveryCodes.map((code) => ({
            codeHash: createHash('sha256').update(code).digest('hex'),
          })),
        },
      },
    })

    const url = otpauthUrl({ secret, account: email, issuer: 'POSitive Loyalty' })

    process.stdout.write(
      [
        '',
        '════════════════════════════════════════════════════════════════',
        '  АДМИН ПЛАТФОРМЫ ЗАВЕДЁН',
        '════════════════════════════════════════════════════════════════',
        '',
        `  Почта:  ${email}`,
        `  Имя:    ${displayName}`,
        `  id:     ${admin.id}`,
        '',
        '  ПАРОЛЬ (показывается один раз, сохраните в менеджер паролей):',
        '',
        `      ${password}`,
        '',
        '  ССЫЛКА ДЛЯ ПОДКЛЮЧЕНИЯ АУТЕНТИФИКАТОРА:',
        '  Откройте её на телефоне или сделайте из неё QR-код.',
        '',
        `      ${url}`,
        '',
        '  Секрет для ручного ввода, если камера не работает:',
        '',
        `      ${secret}`,
        '',
        '  КОДЫ ВОССТАНОВЛЕНИЯ (на случай потерянного телефона).',
        '  Распечатайте и уберите отдельно от пароля. Каждый работает один раз:',
        '',
        ...recoveryCodes.map((code) => `      ${code}`),
        '',
        '  ЧТО ДАЛЬШЕ: подключите аутентификатор по ссылке выше и войдите.',
        '  Первый удачный вход САМ подтвердит второй фактор — отдельного шага',
        '  подтверждения нет и быть не может: чтобы до него добраться, надо',
        '  войти, а вход требует кода. Круг разрывает сам сошедшийся код.',
        '',
        '════════════════════════════════════════════════════════════════',
        '',
      ].join('\n'),
    )
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((error: unknown) => {
  const reason = error instanceof Error ? error.message : 'неизвестная ошибка'
  process.stderr.write(`\nНе удалось завести админа платформы:\n${reason}\n\n`)
  process.exit(1)
})
