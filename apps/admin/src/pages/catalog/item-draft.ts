import type { CreateCatalogItemInput } from '@positive/contracts'

import type { TranslationKey } from '../../shared/i18n'

/**
 * Черновик позиции каталога. docs/03, раздел 9.3.
 *
 * ЦЕНЫ ВЛАДЕЛЕЦ ПИШЕТ В БАТАХ, А ЖУРНАЛ СЧИТАЕТ В САТАНГАХ. Перевод живёт
 * здесь и только здесь: если он размажется по экрану, однажды позиция
 * за 320 ฿ станет позицией за 3,20 ฿.
 *
 * ПОЗИЦИЯ БЕЗ ЕДИНОЙ ЦЕНЫ БЕССМЫСЛЕННА: ни гость не поймёт, что с ней делать,
 * ни владелец не вспомнит, зачем завёл.
 */

export interface ItemDraft {
  readonly name: string
  readonly description: string
  /** Цена деньгами, в батах, как её пишет владелец. */
  readonly priceBaht: string
  /** Цена в баллах. */
  readonly points: string
  readonly imageUrl: string
}

export const BLANK_ITEM: ItemDraft = {
  name: '',
  description: '',
  priceBaht: '',
  points: '',
  imageUrl: '',
}

export type ItemProblem = 'name' | 'price' | 'image'

export type ItemCheck =
  | { readonly ok: true; readonly input: CreateCatalogItemInput }
  | { readonly ok: false; readonly problem: ItemProblem }

export const ITEM_PROBLEM: Readonly<Record<ItemProblem, TranslationKey>> = {
  name: 'catalog.problem.name',
  price: 'catalog.problem.price',
  image: 'catalog.problem.image',
}

const isHttps = (value: string): boolean => {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

const number = (value: string): number | null => {
  const trimmed = value.trim()

  if (trimmed === '') {
    return null
  }

  const parsed = Number(trimmed.replace(',', '.'))

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : Number.NaN
}

export const fromItemDraft = (draft: ItemDraft, sortOrder: number): ItemCheck => {
  const name = draft.name.trim()

  if (name.length < 2) {
    return { ok: false, problem: 'name' }
  }

  const baht = number(draft.priceBaht)
  const points = number(draft.points)

  if (Number.isNaN(baht) || Number.isNaN(points)) {
    return { ok: false, problem: 'price' }
  }

  // Хотя бы одна цена: иначе непонятно, что это и зачем оно на витрине.
  if (baht === null && points === null) {
    return { ok: false, problem: 'price' }
  }

  const imageUrl = draft.imageUrl.trim()

  if (imageUrl !== '' && !isHttps(imageUrl)) {
    return { ok: false, problem: 'image' }
  }

  return {
    ok: true,
    input: {
      name,
      description: draft.description.trim(),
      // Баты в сатанги — здесь и больше нигде.
      priceMinor: baht === null ? null : Math.round(baht * 100),
      pointsPrice: points === null || points === 0 ? null : Math.round(points),
      imageUrl: imageUrl === '' ? null : imageUrl,
      sortOrder,
    },
  }
}
