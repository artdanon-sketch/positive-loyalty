import { Fragment, useState } from 'react'
import type { ReactElement } from 'react'

import { useAuth } from '../../../shared/auth/auth-context'
import { useCertificates, useUpdateCertificate } from '../../../shared/certificates/hooks'
import { describePromoTerms } from '../../../shared/certificates/promo-terms-draft'
import { certificateValueText } from '../../../shared/certificates/value-text'
import { fill } from '../../../shared/format/fill'
import { useT } from '../../../shared/i18n'
import { CertificateForm } from './certificate-form'
import { PromoTermsEditor } from './promo-terms-editor'

/**
 * Вкладка «Сертификаты» в «Акциях». docs/03, раздел 4 · docs/11, У9.
 *
 * Список шаблонов со счётчиками «выдано / использовано»: по ним видно, какой подарок
 * гостям действительно нужен. Менеджер видит список — дарит он из карточки гостя;
 * заводит и выключает владелец.
 *
 * У ПРОМО — ЕГО УСЛОВИЯ ПРЯМО В СТРОКЕ: «до 31.10 · осталось 88 из 100».
 * Продлить или поменять тираж — кнопкой «Условия», без нового шаблона.
 */
export function CertificatesView(): ReactElement {
  const t = useT()
  const isOwner = useAuth().session?.subject.role === 'OWNER'
  const certificates = useCertificates()
  const update = useUpdateCertificate()
  const [editing, setEditing] = useState<string | null>(null)
  const columns = isOwner ? 6 : 5

  return (
    <>
      <section className="panel" aria-labelledby="certificates-title">
        <h2 className="panel__title" id="certificates-title">
          {t('certificates.title')}
        </h2>
        <p className="field__hint">{t('certificates.hint')}</p>

        {certificates.isPending ? (
          <p className="state__hint" role="status">
            {t('common.loading')}
          </p>
        ) : certificates.isError ? (
          <p className="state__hint state__hint--error" role="alert">
            {certificates.error.message}
          </p>
        ) : certificates.data.length === 0 ? (
          <p className="state__hint">{t('certificates.empty')}</p>
        ) : (
          <div className="table-scroll">
            <table className="data-table" aria-labelledby="certificates-title">
              <thead>
                <tr>
                  <th>{t('certificates.col.title')}</th>
                  <th>{t('certificates.col.value')}</th>
                  <th className="data-table__num">{t('certificates.col.validity')}</th>
                  <th className="data-table__num">{t('certificates.col.issued')}</th>
                  <th className="data-table__num">{t('certificates.col.redeemed')}</th>
                  {isOwner ? <th /> : null}
                </tr>
              </thead>
              <tbody>
                {certificates.data.map((certificate) => (
                  <Fragment key={certificate.id}>
                    <tr className={certificate.isActive ? undefined : 'data-table__row--muted'}>
                      <td>
                        {certificate.title}
                        {certificate.selfClaim ? (
                          <>
                            {' '}
                            <span className="chip">{t('certificates.promo')}</span>
                          </>
                        ) : null}
                        {certificate.isActive ? null : (
                          <>
                            {' '}
                            <span className="chip chip--muted">{t('certificates.off')}</span>
                          </>
                        )}
                        {certificate.selfClaim ? (
                          <span className="field__hint certificate-promo">
                            {describePromoTerms(certificate.promo, certificate.issued, t)}
                          </span>
                        ) : null}
                      </td>
                      <td>{certificateValueText(certificate.value, t)}</td>
                      <td className="data-table__num">
                        {fill(t('certificates.days'), { n: certificate.validityDays })}
                      </td>
                      <td className="data-table__num">{certificate.issued}</td>
                      <td className="data-table__num">{certificate.redeemed}</td>
                      {isOwner ? (
                        <td className="data-table__actions">
                          {certificate.selfClaim ? (
                            <button
                              className="button"
                              type="button"
                              aria-expanded={editing === certificate.id}
                              onClick={() => {
                                setEditing(editing === certificate.id ? null : certificate.id)
                              }}
                            >
                              {t('certificates.promoTerms.edit')}
                            </button>
                          ) : null}
                          <button
                            className="button"
                            type="button"
                            disabled={update.isPending}
                            onClick={() => {
                              update.mutate({
                                id: certificate.id,
                                input: { selfClaim: !certificate.selfClaim },
                              })
                            }}
                          >
                            {t(
                              certificate.selfClaim
                                ? 'certificates.promo.off'
                                : 'certificates.promo.on',
                            )}
                          </button>
                          <button
                            className="button"
                            type="button"
                            disabled={update.isPending}
                            onClick={() => {
                              update.mutate({
                                id: certificate.id,
                                input: { isActive: !certificate.isActive },
                              })
                            }}
                          >
                            {t(
                              certificate.isActive ? 'certificates.disable' : 'certificates.enable',
                            )}
                          </button>
                        </td>
                      ) : null}
                    </tr>
                    {editing === certificate.id ? (
                      <tr>
                        <td colSpan={columns}>
                          <PromoTermsEditor
                            certificate={certificate}
                            onDone={() => {
                              setEditing(null)
                            }}
                          />
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {update.isError ? (
          <p className="state__hint state__hint--error" role="alert">
            {update.error.message}
          </p>
        ) : null}
      </section>

      {isOwner ? <CertificateForm /> : null}
    </>
  )
}
