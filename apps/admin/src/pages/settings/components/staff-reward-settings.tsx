import type { ReactElement } from 'react'

import { useT } from '../../../shared/i18n'
import { useStaffReportForRewards, useStaffRewardSettings } from '../hooks'
import { StaffRewardForm } from './staff-reward-form'

/**
 * Блок «Доплата кассирам» на экране настроек. docs/03, раздел 6.
 *
 * Свои данные и своя кнопка сохранения, как у приглашений: доплата — отдельный
 * вход на сервере, и сохранение статусов не должно её переписывать.
 *
 * Цифры для расчёта стоимости берём из отчёта «Сотрудники» за месяц: обещание
 * «обойдётся примерно во столько» должно опираться на то, что уже происходит.
 */
export function StaffRewardSettingsSection(): ReactElement {
  const t = useT()
  const settings = useStaffRewardSettings()
  const report = useStaffReportForRewards()

  const facts =
    report.data === undefined
      ? null
      : {
          receipts: report.data.staff.reduce((sum, row) => sum + row.operations, 0),
          newGuests: report.data.staff.reduce((sum, row) => sum + row.newGuests, 0),
          turnover: report.data.staff.reduce((sum, row) => sum + row.turnover, 0),
          // Начисленных баллов в отчёте нет: для процента от баллов берём
          // оценку по базовой ставке — точную цифру покажет первый же месяц.
          pointsEarned: 0,
          days: 30,
        }

  return (
    <section className="panel" aria-labelledby="staff-reward-title">
      <h2 className="panel__title" id="staff-reward-title">
        {t('staffReward.title')}
      </h2>
      <p className="field__hint">{t('staffReward.hint')}</p>

      {settings.isPending ? (
        <p className="state__hint" role="status">
          {t('common.loading')}
        </p>
      ) : settings.isError ? (
        <div role="alert">
          <p className="state__hint state__hint--error">{settings.error.message}</p>
          <button
            className="button"
            type="button"
            onClick={() => {
              void settings.refetch()
            }}
          >
            {t('common.retry')}
          </button>
        </div>
      ) : (
        <StaffRewardForm initial={settings.data} facts={facts} />
      )}
    </section>
  )
}
