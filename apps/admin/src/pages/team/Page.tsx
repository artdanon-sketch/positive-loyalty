import { useState } from 'react'
import type { ReactElement } from 'react'

import { useT } from '../../shared/i18n'
import { AccessCard } from './components/access-card'
import { AddStaffForm } from './components/add-staff-form'
import { StaffRow } from './components/staff-row'
import { useTeam } from './hooks'

/**
 * Экран «Команда»: кто работает на кассе и в бэк-офисе.
 *
 * ЭКРАН ОТВЕЧАЕТ НА ТРИ СИТУАЦИИ, А НЕ НА «УПРАВЛЕНИЕ ПЕРСОНАЛОМ»:
 *   пришёл новый кассир   — добавить и сразу передать ему код устройства и PIN;
 *   кассир забыл PIN      — задать новый, не выясняя старый;
 *   кассира уволили       — отключить так, чтобы доступ пропал сейчас,
 *                           а не в конце его смены.
 *
 * PIN ПОКАЗЫВАЕТСЯ ОДИН РАЗ. Владелец его придумал, сервер хранит только хеш,
 * и после карточки доступа PIN не видит никто. Это не неудобство, а договор:
 * PIN знают двое — тот, кто задал, и тот, кому передали.
 */
export function TeamPage(): ReactElement {
  const t = useT()
  const team = useTeam()
  const [adding, setAdding] = useState(false)
  const [access, setAccess] = useState<{ name: string; deviceCode: string; pin: string } | null>(
    null,
  )

  const onlyOwners = team.data !== undefined && team.data.every((member) => member.role === 'OWNER')

  return (
    <section className="page">
      <header className="page__head page__head--row">
        <div>
          <h1 className="page__title">{t('team.title')}</h1>
          <p className="page__subtitle">{t('team.subtitle')}</p>
        </div>
        {adding || access !== null ? null : (
          <button
            className="button button--primary"
            type="button"
            onClick={() => {
              setAdding(true)
            }}
          >
            {t('team.add')}
          </button>
        )}
      </header>

      {access !== null ? (
        <AccessCard
          name={access.name}
          deviceCode={access.deviceCode}
          pin={access.pin}
          onDone={() => {
            // PIN покидает память страницы вместе с карточкой.
            setAccess(null)
          }}
        />
      ) : null}

      {adding ? (
        <AddStaffForm
          onCancel={() => {
            setAdding(false)
          }}
          onCreated={(result, pin) => {
            setAdding(false)
            setAccess({ name: result.staff.displayName, deviceCode: result.deviceCode, pin })
          }}
        />
      ) : null}

      {team.isPending ? (
        <div className="state" role="status">
          <p className="state__title">{t('common.loading')}</p>
        </div>
      ) : team.isError ? (
        <div className="state state--error" role="alert">
          <p className="state__title">{t('common.error.title')}</p>
          <p className="state__hint">{team.error.message}</p>
          <button
            className="button button--primary"
            type="button"
            onClick={() => {
              void team.refetch()
            }}
          >
            {t('common.retry')}
          </button>
        </div>
      ) : (
        <>
          {onlyOwners && !adding && access === null ? (
            <div className="state">
              <p className="state__title">{t('team.onlyYou.title')}</p>
              <p className="state__hint">{t('team.onlyYou.hint')}</p>
            </div>
          ) : null}

          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t('team.col.name')}</th>
                  <th>{t('team.col.role')}</th>
                  <th>{t('team.col.status')}</th>
                  <th>{t('team.col.lastSeen')}</th>
                  <th>{t('team.col.device')}</th>
                  <th>{t('team.col.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {team.data.map((member) => (
                  <StaffRow key={member.id} member={member} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
