import type { ReactElement } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'

import { OverviewPage } from '../pages/overview/Page'
import { AppShell } from './app-shell'

/**
 * Маршруты бэк-офиса. Пока один: «Обзор» на `/`
 * (docs/03_Бэк-офис_экраны.md, раздел 1 — там же остальные семь на будущее).
 */
export function AppRoutes(): ReactElement {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route index element={<OverviewPage />} />
        {/* Неизвестный адрес возвращает на «Обзор», а не в пустоту. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
