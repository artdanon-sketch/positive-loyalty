import { z } from 'zod'

/**
 * Коды, которые люди читают вслух и набирают руками: приглашения друзей,
 * ссылки источников трафика. docs/05, раздел 6.3.
 *
 * Восемь знаков алфавита без 0, O, 1, I и L — того же, из которого их выдаёт
 * сервер (apps/api/src/core/random-code.ts). Регистр не важен: «7kq2mx4p»,
 * набранный с телефона, — тот же код.
 */

export const HUMAN_CODE_LENGTH = 8

export const HumanCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[2-9A-HJKMNP-Z]{8}$/, 'Код — восемь букв и цифр')
