import { BROADCAST_TEXT_MAX } from '@positive/contracts'
import { describe, expect, it } from 'vitest'

import { audienceOfSegment, charsLeft, draftIssues, emptyDraft } from './broadcast-draft'

/**
 * Рассылку нельзя отозвать, поэтому проверяем не «кнопка серая», а «сказали,
 * почему»: каждая помеха — отдельная строка перед глазами владельца.
 */

const draft = (extra: Partial<ReturnType<typeof emptyDraft>> = {}) => ({
  ...emptyDraft(),
  title: 'Осенняя',
  text: 'Скучаем! Заходите на кофе.',
  ...extra,
})

describe('Черновик рассылки: что мешает отправить', () => {
  it('ГОТОВЫЙ ЧЕРНОВИК НЕ ВЫЗЫВАЕТ ВОЗРАЖЕНИЙ', () => {
    const preview = { found: 31, willReceive: 19, tired: 5, unreachable: 7 }

    expect(draftIssues(draft(), preview)).toEqual([])
  })

  it('ПУСТОЕ НАЗВАНИЕ И ПУСТОЙ ТЕКСТ — ДВЕ РАЗНЫЕ ПРИЧИНЫ', () => {
    expect(draftIssues(draft({ title: ' ', text: '' }), undefined)).toEqual([
      'broadcasts.issue.title',
      'broadcasts.issue.text',
    ])
  })

  it('СЛИШКОМ ДЛИННЫЙ ТЕКСТ ЗАМЕЧАЕМ ДО ОТПРАВКИ, А НЕ ПОСЛЕ ОТКАЗА СЕРВЕРА', () => {
    const issues = draftIssues(draft({ text: 'а'.repeat(BROADCAST_TEXT_MAX + 1) }), undefined)

    expect(issues).toContain('broadcasts.issue.long')
  })

  it('«НИКТО НЕ ПОЛУЧИТ» — ПОМЕХА, А «ЕЩЁ НЕ СЧИТАЛИ» — НЕТ', () => {
    expect(draftIssues(draft(), { found: 4, willReceive: 0, tired: 4, unreachable: 0 })).toEqual([
      'broadcasts.issue.nobody',
    ])
    expect(draftIssues(draft(), undefined)).toEqual([])
  })
})

describe('Черновик рассылки: подарок', () => {
  const withPoints = draft({ gift: { kind: 'POINTS', points: '100', certificateId: '' } })

  it('С ПОДАРКОМ «СООБЩЕНИЕ НИКТО НЕ ПОЛУЧИТ» — НЕ ПОМЕХА: ПОДАРОК ЖДЁТ НА КАРТЕ', () => {
    expect(draftIssues(withPoints, { found: 4, willReceive: 0, tired: 0, unreachable: 4 })).toEqual(
      [],
    )
  })

  it('С ПОДАРКОМ ПОМЕХА — ТОЛЬКО ПУСТАЯ АУДИТОРИЯ', () => {
    expect(draftIssues(withPoints, { found: 0, willReceive: 0, tired: 0, unreachable: 0 })).toEqual(
      ['broadcasts.issue.empty'],
    )
  })

  it('НЕГОДНЫЙ ПОДАРОК — СВОЯ ПРИЧИНА, А НЕ ОБЩАЯ СЕРАЯ КНОПКА', () => {
    expect(
      draftIssues(draft({ gift: { kind: 'POINTS', points: '0', certificateId: '' } }), undefined),
    ).toEqual(['campaignGift.problem.points'])
    expect(
      draftIssues(
        draft({ gift: { kind: 'CERTIFICATE', points: '', certificateId: '' } }),
        undefined,
      ),
    ).toEqual(['campaignGift.problem.certificate'])
  })
})

describe('Черновик рассылки: сегменты', () => {
  it('«ВСЕ» — ЭТО ОТСУТСТВИЕ ФИЛЬТРОВ, А НЕ ОСОБЫЙ ФИЛЬТР', () => {
    expect(audienceOfSegment('all')).toEqual({})
  })

  it('КАЖДЫЙ СЕГМЕНТ ПЕРЕВОДИТСЯ В ФИЛЬТРЫ СПИСКА ГОСТЕЙ', () => {
    expect(audienceOfSegment('sleeping')).toEqual({ sleeping: 30 })
    expect(audienceOfSegment('no-purchase')).toEqual({ buyers: 'none' })
    expect(audienceOfSegment('tourists')).toEqual({ mode: 'TOURIST' })
  })

  it('СЧЁТЧИК ЗНАКОВ СЧИТАЕТ ПО ОБРЕЗАННОМУ ТЕКСТУ: ПРОБЕЛЫ НЕ ТРАТЯТ ЛИМИТ', () => {
    expect(charsLeft('  привет  ')).toBe(BROADCAST_TEXT_MAX - 6)
  })
})
