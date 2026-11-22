/**
 * Скин карты гостя: фиолетовый или оранжевый (22.11.2026).
 *
 * Владелец выбрал из пяти цветов два — «3й и 4 нравятся, можно сделать два
 * скина». Мятный остался бэк-офису: там атрибута data-skin нет, и токены
 * берутся из :root. Значения цветов — в `packages/ui/src/tokens.css`.
 *
 * Скин — выбор гостя на этом устройстве, а не настройка заведения: карта одна
 * на все заведения, и красить её в цвет одного из них было бы неправдой.
 *
 * Ключ продублирован в `apps/guest/index.html`: инлайн-скрипт ставит скин до
 * загрузки бандла, иначе гость видит вспышку мятного.
 */
export type Skin = 'violet' | 'orange'

export const SKINS: readonly Skin[] = ['violet', 'orange']

export const DEFAULT_SKIN: Skin = 'violet'

export const SKIN_STORAGE_KEY = 'positive:guest-skin'

const isSkin = (value: unknown): value is Skin => value === 'violet' || value === 'orange'

export function getInitialSkin(): Skin {
  try {
    const stored: unknown = localStorage.getItem(SKIN_STORAGE_KEY)
    return isSkin(stored) ? stored : DEFAULT_SKIN
  } catch {
    return DEFAULT_SKIN
  }
}

/** Ставит скин на <html>; `remember` — запомнить как осознанный выбор. */
export function applySkin(skin: Skin, remember = true): Skin {
  document.documentElement.dataset.skin = skin
  if (remember) {
    try {
      localStorage.setItem(SKIN_STORAGE_KEY, skin)
    } catch {
      // Не запомнили — на этой странице скин всё равно применён.
    }
  }
  return skin
}
