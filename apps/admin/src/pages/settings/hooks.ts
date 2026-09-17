import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query'
import type {
  BirthdaySettings,
  ProgramSettings,
  ReferralSettings,
  ReviewSettings,
  StaffReport,
  StaffRewardSettings,
  SuspiciousSettings,
  TierSettings,
} from '@positive/contracts'

import { useAuth } from '../../shared/auth/auth-context'

/**
 * Настройки программы.
 *
 * После сохранения сбрасывается и кэш правил кассы: планшет, открытый в том же
 * браузере, иначе продолжал бы требовать номер чека, который владелец только что
 * сделал необязательным, — до перезагрузки страницы.
 */

const KEY = ['admin', 'settings', 'program'] as const
const TIERS_KEY = ['admin', 'settings', 'tiers'] as const
const REFERRAL_KEY = ['admin', 'settings', 'referral'] as const
const STAFF_REWARD_KEY = ['admin', 'settings', 'staff-reward'] as const
const BIRTHDAY_KEY = ['admin', 'settings', 'birthday'] as const
const REVIEWS_KEY = ['admin', 'settings', 'reviews'] as const
const SUSPICIOUS_KEY = ['admin', 'settings', 'suspicious'] as const

export function useProgramSettings(): UseQueryResult<ProgramSettings, Error> {
  const { authFetch } = useAuth()

  return useQuery({
    queryKey: KEY,
    queryFn: () => authFetch<ProgramSettings>('/admin/settings/program'),
  })
}

export function useSaveProgramSettings(): UseMutationResult<
  ProgramSettings,
  Error,
  ProgramSettings
> {
  const { authFetch } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (settings) =>
      authFetch<ProgramSettings>('/admin/settings/program', {
        method: 'PUT',
        body: JSON.stringify(settings),
        headers: { 'Content-Type': 'application/json' },
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(KEY, saved)
      void queryClient.invalidateQueries({ queryKey: ['pos', 'config'] })
    },
  })
}

/** Статусы гостей и приветственные баллы — своим входом (docs/02, раздел 5.6.1). */
export function useTierSettings(): UseQueryResult<TierSettings, Error> {
  const { authFetch } = useAuth()

  return useQuery({
    queryKey: TIERS_KEY,
    queryFn: () => authFetch<TierSettings>('/admin/settings/program/tiers'),
  })
}

/**
 * Сохранить лестницу. Карточки гостей перечитываются: статус в них считается
 * по лестнице и после сохранения мог стать другим.
 */
export function useSaveTierSettings(): UseMutationResult<TierSettings, Error, TierSettings> {
  const { authFetch } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (settings) =>
      authFetch<TierSettings>('/admin/settings/program/tiers', {
        method: 'PUT',
        body: JSON.stringify(settings),
        headers: { 'Content-Type': 'application/json' },
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(TIERS_KEY, saved)
      void queryClient.invalidateQueries({ queryKey: ['admin', 'guest-card'] })
    },
  })
}

/** Приглашения друзей — своим входом (docs/02, раздел 5.6.2). */
export function useReferralSettings(): UseQueryResult<ReferralSettings, Error> {
  const { authFetch } = useAuth()

  return useQuery({
    queryKey: REFERRAL_KEY,
    queryFn: () => authFetch<ReferralSettings>('/admin/settings/program/referral'),
  })
}

export function useSaveReferralSettings(): UseMutationResult<
  ReferralSettings,
  Error,
  ReferralSettings
> {
  const { authFetch } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (settings) =>
      authFetch<ReferralSettings>('/admin/settings/program/referral', {
        method: 'PUT',
        body: JSON.stringify(settings),
        headers: { 'Content-Type': 'application/json' },
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(REFERRAL_KEY, saved)
    },
  })
}

/** Доплата кассирам — своим входом (docs/03, раздел 6). */
export function useStaffRewardSettings(): UseQueryResult<StaffRewardSettings, Error> {
  const { authFetch } = useAuth()

  return useQuery({
    queryKey: STAFF_REWARD_KEY,
    queryFn: () => authFetch<StaffRewardSettings>('/admin/settings/program/staff-reward'),
  })
}

export function useSaveStaffRewardSettings(): UseMutationResult<
  StaffRewardSettings,
  Error,
  StaffRewardSettings
> {
  const { authFetch } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (settings) =>
      authFetch<StaffRewardSettings>('/admin/settings/program/staff-reward', {
        method: 'PUT',
        body: JSON.stringify(settings),
        headers: { 'Content-Type': 'application/json' },
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(STAFF_REWARD_KEY, saved)
    },
  })
}

/**
 * Отчёт «Сотрудники» за месяц — только ради расчёта стоимости доплаты.
 *
 * Тот же адрес, что у самого отчёта: второй источник тех же чисел означал бы,
 * что настройка обещает одно, а отчёт показывает другое.
 */
export function useStaffReportForRewards(): UseQueryResult<StaffReport, Error> {
  const { authFetch } = useAuth()

  return useQuery({
    queryKey: ['admin', 'reports', 'staff', '30d'],
    queryFn: () => authFetch<StaffReport>('/admin/reports/staff?period=30d'),
  })
}

/** Подарок ко дню рождения — своим входом (docs/02, раздел 5.6.3). */
export function useBirthdaySettings(): UseQueryResult<BirthdaySettings, Error> {
  const { authFetch } = useAuth()

  return useQuery({
    queryKey: BIRTHDAY_KEY,
    queryFn: () => authFetch<BirthdaySettings>('/admin/settings/program/birthday'),
  })
}

export function useSaveBirthdaySettings(): UseMutationResult<
  BirthdaySettings,
  Error,
  BirthdaySettings
> {
  const { authFetch } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (settings) =>
      authFetch<BirthdaySettings>('/admin/settings/program/birthday', {
        method: 'PUT',
        body: JSON.stringify(settings),
        headers: { 'Content-Type': 'application/json' },
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(BIRTHDAY_KEY, saved)
    },
  })
}

/** Автоответы на отзывы — своим входом (docs/02, раздел 5.6.4). */
export function useReviewSettings(): UseQueryResult<ReviewSettings, Error> {
  const { authFetch } = useAuth()

  return useQuery({
    queryKey: REVIEWS_KEY,
    queryFn: () => authFetch<ReviewSettings>('/admin/settings/program/reviews'),
  })
}

export function useSaveReviewSettings(): UseMutationResult<ReviewSettings, Error, ReviewSettings> {
  const { authFetch } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (settings) =>
      authFetch<ReviewSettings>('/admin/settings/program/reviews', {
        method: 'PUT',
        body: JSON.stringify(settings),
        headers: { 'Content-Type': 'application/json' },
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(REVIEWS_KEY, saved)
    },
  })
}

/** Порог подозрительных чеков — своим входом (docs/02, раздел 5.6.5). */
export function useSuspiciousSettings(): UseQueryResult<SuspiciousSettings, Error> {
  const { authFetch } = useAuth()

  return useQuery({
    queryKey: SUSPICIOUS_KEY,
    queryFn: () => authFetch<SuspiciousSettings>('/admin/settings/program/suspicious'),
  })
}

/** Сохранить порог. Разбор «Подозрительное» перечитывается: список зависит от порога. */
export function useSaveSuspiciousSettings(): UseMutationResult<
  SuspiciousSettings,
  Error,
  SuspiciousSettings
> {
  const { authFetch } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (settings) =>
      authFetch<SuspiciousSettings>('/admin/settings/program/suspicious', {
        method: 'PUT',
        body: JSON.stringify(settings),
        headers: { 'Content-Type': 'application/json' },
      }),
    onSuccess: (saved) => {
      queryClient.setQueryData(SUSPICIOUS_KEY, saved)
      void queryClient.invalidateQueries({ queryKey: ['admin', 'security', 'suspicious'] })
    },
  })
}
