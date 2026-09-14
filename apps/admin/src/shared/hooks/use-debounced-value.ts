import { useEffect, useState } from 'react'

/**
 * Значение, которое догоняет исходное через `delayMs` после последнего изменения.
 *
 * Поле ввода меняется сразу, а запрос к серверу уходит, когда человек перестал
 * печатать: иначе «Анна» улетела бы на сервер четырьмя запросами, и ответ на «Ан»
 * мог прийти последним и затереть правильный.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebounced(value)
    }, delayMs)

    return () => {
      window.clearTimeout(timer)
    }
  }, [value, delayMs])

  return debounced
}
