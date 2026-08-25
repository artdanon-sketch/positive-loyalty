// Матчеры вида toBeInTheDocument. Вариант /vitest регистрирует их в expect из vitest,
// поэтому globals включать не нужно — импорты в тестах остаются явными.
import '@testing-library/jest-dom/vitest'
