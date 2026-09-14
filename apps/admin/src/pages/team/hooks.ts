import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query'
import type {
  CreateStaffInput,
  CreateStaffResult,
  ResetStaffPinInput,
  StaffMember,
  UpdateStaffInput,
} from '@positive/contracts'

import { useAuth } from '../../shared/auth/auth-context'

/**
 * Команда заведения.
 *
 * Список перечитывается после каждой правки: отключение, смена роли и новый
 * PIN меняют сразу несколько полей строки (статус, блокировку, устройства),
 * и собирать их на клиенте значило бы завести вторую правду о доступе.
 */

const KEY = ['admin', 'staff'] as const

const json = (body: unknown): RequestInit => ({
  body: JSON.stringify(body),
  headers: { 'Content-Type': 'application/json' },
})

export function useTeam(): UseQueryResult<StaffMember[], Error> {
  const { authFetch } = useAuth()

  return useQuery({
    queryKey: KEY,
    queryFn: () => authFetch<StaffMember[]>('/admin/staff'),
  })
}

export function useAddStaff(): UseMutationResult<CreateStaffResult, Error, CreateStaffInput> {
  const { authFetch } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input) =>
      authFetch<CreateStaffResult>('/admin/staff', { method: 'POST', ...json(input) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: KEY })
    },
  })
}

export function useUpdateStaff(): UseMutationResult<
  StaffMember,
  Error,
  { id: string; patch: UpdateStaffInput }
> {
  const { authFetch } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, patch }) =>
      authFetch<StaffMember>(`/admin/staff/${id}`, { method: 'PATCH', ...json(patch) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: KEY })
    },
  })
}

export function useResetStaffPin(): UseMutationResult<
  StaffMember,
  Error,
  { id: string } & ResetStaffPinInput
> {
  const { authFetch } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, pin }) =>
      authFetch<StaffMember>(`/admin/staff/${id}/pin`, { method: 'POST', ...json({ pin }) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: KEY })
    },
  })
}
