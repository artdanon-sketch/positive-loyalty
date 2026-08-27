// Матчеры вида toBeInTheDocument. Вариант /vitest регистрирует их в expect из vitest,
// поэтому globals включать не нужно — импорты в тестах остаются явными.
import '@testing-library/jest-dom/vitest'

import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

// Размонтирование между тестами. Автоматическим оно бывает только при
// globals: true — а у нас импорты явные, и без этой строки DOM предыдущего
// теста остаётся на странице: getByRole находит две кнопки вместо одной
// и падает с «Found multiple elements».
afterEach(() => {
  cleanup()
})
