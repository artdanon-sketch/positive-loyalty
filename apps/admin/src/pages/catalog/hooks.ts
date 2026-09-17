import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { UseMutationResult, UseQueryResult } from '@tanstack/react-query'
import type {
  CatalogItem,
  CreateCatalogItemInput,
  UpdateCatalogItemInput,
} from '@positive/contracts'

import { useAuth } from '../../shared/auth/auth-context'

/** Каталог товаров и услуг. docs/02, раздел 5.17. */

const CATALOG_KEY = ['admin', 'catalog'] as const

export function useCatalog(): UseQueryResult<CatalogItem[], Error> {
  const { authFetch } = useAuth()

  return useQuery({
    queryKey: CATALOG_KEY,
    queryFn: () => authFetch<CatalogItem[]>('/admin/catalog'),
  })
}

export function useCreateCatalogItem(): UseMutationResult<
  CatalogItem,
  Error,
  CreateCatalogItemInput
> {
  const { authFetch } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input) =>
      authFetch<CatalogItem>('/admin/catalog', {
        method: 'POST',
        body: JSON.stringify(input),
        headers: { 'Content-Type': 'application/json' },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CATALOG_KEY })
    },
  })
}

export function useUpdateCatalogItem(): UseMutationResult<
  CatalogItem,
  Error,
  { id: string; input: UpdateCatalogItemInput }
> {
  const { authFetch } = useAuth()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ id, input }) =>
      authFetch<CatalogItem>(`/admin/catalog/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
        headers: { 'Content-Type': 'application/json' },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: CATALOG_KEY })
    },
  })
}
