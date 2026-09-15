import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query'
import type {
  CertificateTemplate,
  CreateCertificateInput,
  UpdateCertificateInput,
} from '@positive/contracts'

import { useAuth } from '../auth/auth-context'

/**
 * Шаблоны сертификатов. docs/02, раздел 5.11.
 *
 * Общие для вкладки «Сертификаты», формы «Подарить» и подарка ко дню рождения:
 * заведённый шаблон сразу виден во всех трёх местах — ключ кэша один.
 */

export const CERTIFICATES_KEY = ['admin', 'certificates'] as const

export function useCertificates(enabled = true): UseQueryResult<CertificateTemplate[], Error> {
  const { authFetch } = useAuth()

  return useQuery({
    queryKey: CERTIFICATES_KEY,
    queryFn: () => authFetch<CertificateTemplate[]>('/admin/certificates'),
    enabled,
  })
}

export function useCreateCertificate(): UseMutationResult<
  CertificateTemplate,
  Error,
  CreateCertificateInput
> {
  const { authFetch } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input) =>
      authFetch<CertificateTemplate>('/admin/certificates', {
        method: 'POST',
        body: JSON.stringify(input),
        headers: { 'Content-Type': 'application/json' },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CERTIFICATES_KEY })
    },
  })
}

export function useUpdateCertificate(): UseMutationResult<
  CertificateTemplate,
  Error,
  { id: string; input: UpdateCertificateInput }
> {
  const { authFetch } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, input }) =>
      authFetch<CertificateTemplate>(`/admin/certificates/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
        headers: { 'Content-Type': 'application/json' },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CERTIFICATES_KEY })
    },
  })
}
