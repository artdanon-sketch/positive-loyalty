import { z } from 'zod'

import { DashboardPeriod } from './admin.js'
import { HumanCode } from './code.js'

/**
 * Источники трафика: откуда гость пришёл в заведение.
 * docs/02, разделы 2.6 и 5.9 · docs/11, У7.
 *
 * Источник — именованная ссылка со своим кодом: «табличка на столе», «Instagram»,
 * «доставка». Гость, вступивший по такой ссылке, помечен этим источником, и владелец
 * видит, сколько гостей, покупателей и выручки принёс каждый.
 *
 * ПЕРВОЕ КАСАНИЕ. Источник записывается при вступлении и потом не меняется: гость,
 * который уже ходит в заведение и отсканировал табличку, «новым из таблички» не станет.
 */

/** Больше сотни источников у малого заведения — это уже не источники, а шум. */
export const CHANNELS_MAX = 100

const ChannelName = z.string().trim().min(1).max(60)

export const Channel = z
  .object({
    id: z.uuid(),
    name: z.string(),
    /** Код ссылки. Выдаёт сервер, владелец его не придумывает. */
    code: z.string(),
    /** Выключенный источник не принимает новых гостей, но остаётся в отчёте. */
    isActive: z.boolean(),
  })
  .strict()

export type Channel = z.infer<typeof Channel>

export const CreateChannelInput = z
  .object({
    name: ChannelName,
  })
  .strict()

export type CreateChannelInput = z.infer<typeof CreateChannelInput>

export const UpdateChannelInput = z
  .object({
    name: ChannelName.optional(),
    isActive: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    error: 'Нечего менять: не передано ни одного поля',
  })

export type UpdateChannelInput = z.infer<typeof UpdateChannelInput>

/** Отчёт по источникам. По умолчанию — месяц: табличка на столе окупается не за неделю. */
export const ChannelReportQuery = z
  .object({
    period: DashboardPeriod.default('30d'),
  })
  .strict()

export type ChannelReportQuery = z.infer<typeof ChannelReportQuery>

export const ChannelReportCounts = z
  .object({
    /** Вступили за период. */
    guests: z.number().int().nonnegative(),
    /** Впервые купили за период. */
    buyers: z.number().int().nonnegative(),
    /** Сумма чеков за период без отменённых, в минорных единицах. */
    revenue: z.number().int().nonnegative(),
  })
  .strict()

export type ChannelReportCounts = z.infer<typeof ChannelReportCounts>

export const ChannelReportRow = z
  .object({
    channelId: z.uuid(),
    name: z.string(),
    code: z.string(),
    isActive: z.boolean(),
    guests: z.number().int().nonnegative(),
    buyers: z.number().int().nonnegative(),
    revenue: z.number().int().nonnegative(),
  })
  .strict()

export type ChannelReportRow = z.infer<typeof ChannelReportRow>

export const ChannelReport = z
  .object({
    period: DashboardPeriod,
    /** Все источники заведения, выручка сверху. */
    channels: z.array(ChannelReportRow),
    /** Гости, пришедшие не по ссылке источника: на кассе, по приглашению друга. */
    unattributed: ChannelReportCounts,
  })
  .strict()

export type ChannelReport = z.infer<typeof ChannelReport>

/** Гость открыл ссылку источника. */
export const JoinVenueInput = z
  .object({
    channel: HumanCode,
  })
  .strict()

export type JoinVenueInput = z.infer<typeof JoinVenueInput>

export const JoinVenueResult = z
  .object({
    tenantId: z.uuid(),
    brandName: z.string(),
    /** false — гость уже был гостем заведения: источник у него не меняется. */
    joined: z.boolean(),
  })
  .strict()

export type JoinVenueResult = z.infer<typeof JoinVenueResult>
