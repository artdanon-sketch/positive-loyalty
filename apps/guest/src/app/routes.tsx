import { Navigate, Route, Routes } from 'react-router-dom'

import { Page as CardPage } from '../pages/card/Page'

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<CardPage />} />
      {/* Неизвестный адрес возвращаем на карту: у гостя в приложении один экран. */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
