import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'

interface QueryProviderProps {
  children: ReactNode
}

function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Мобильная сеть на острове рвётся: одна повторная попытка лучше, чем ошибка сразу.
        retry: 1,
        staleTime: 30_000,
        refetchOnWindowFocus: false,
      },
    },
  })
}

export function QueryProvider({ children }: QueryProviderProps) {
  // Клиент создаётся один раз на монтирование: новый экземпляр на каждый рендер
  // обнулял бы кэш и превращал приложение в сплошную загрузку.
  const [client] = useState(createQueryClient)

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
