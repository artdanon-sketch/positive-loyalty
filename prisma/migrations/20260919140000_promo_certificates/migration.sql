-- Промо-сертификаты: гость забирает сертификат сам из приложения.
--
-- Раньше сертификат (Offer вида GIFT_CARD) попадал гостю только через персонал —
-- «Подарить» из карточки или подарок ко дню рождения. Промо-сертификат гость
-- берёт себе сам: заведение объявляет его, гость видит на карте и жмёт «Забрать».
--
-- Флаг selfClaim, а не новое значение visibility: visibility отвечает, какие
-- ЗАВЕДЕНИЯ видят акцию (сеть, партнёр), а тут вопрос, может ли её взять ГОСТЬ.
-- Только для GIFT_CARD: движок правил кассы и список «Акции» такие не трогают.
-- Колонка с DEFAULT false обратимо совместима: у всех существующих акций — false,
-- поведение не меняется.
ALTER TABLE "Offer" ADD COLUMN "selfClaim" BOOLEAN NOT NULL DEFAULT false;

-- Гость видит промо-сертификаты заведений, где он участвует — по образцу
-- guest_catalog. Обычная политика guest_offers привязана к уже выданному гранту
-- (гость видит акцию ПОСЛЕ получения); промо нужно увидеть ДО, поэтому отдельная
-- политика чтения. Несколько permissive SELECT-политик складываются по OR.
-- Отдаём только LIVE self-claim GIFT_CARD: выключенный или чужой промо не виден,
-- а значит и не берётся (endpoint «Забрать» опирается на эту же видимость).
CREATE POLICY guest_promo_offers ON "Offer"
  FOR SELECT
  USING (
    "selfClaim"
    AND "type"::text = 'GIFT_CARD'
    AND "status"::text = 'LIVE'
    AND EXISTS (
      SELECT 1 FROM "Membership" m
      WHERE m."tenantId" = "Offer"."tenantId"
        AND m."guestId" = current_setting('app.guest_id', true)
    )
  );
