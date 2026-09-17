import type { ProgramSettings } from '@positive/contracts'

/**
 * Сравнение настроек программы: изменилось или нет. docs/03, раздел 9.
 *
 * ПОЛЯ СРАВНИВАЮТСЯ ПОИМЁННО, А НЕ ЧЕРЕЗ JSON. Сравнение строк ломается дважды:
 * от порядка ключей в ответе сервера и от полей, которых в ответе может не быть
 * вовсе — настройка появилась позже, старое заведение её не хранит. И то и другое
 * давало «есть изменения» на форме, которую никто не трогал.
 *
 * ОТСУТСТВУЮЩЕЕ ПОЛЕ РАВНО ВЫКЛЮЧЕННОМУ: сервер, не приславший «кассир видит
 * теги», не включал их.
 */

const flag = (value: boolean | undefined): boolean => value ?? false

export const sameProgramSettings = (left: ProgramSettings, right: ProgramSettings): boolean =>
  left.baseEarnRate === right.baseEarnRate &&
  left.baseRedeemRate === right.baseRedeemRate &&
  (left.pointsExpireDays ?? null) === (right.pointsExpireDays ?? null) &&
  left.cashierRules.requireReceiptNumber === right.cashierRules.requireReceiptNumber &&
  left.cashierRules.maxManualAmount === right.cashierRules.maxManualAmount &&
  left.cashierRules.allowManualEntry === right.cashierRules.allowManualEntry &&
  flag(left.cashierRules.showGuestTags) === flag(right.cashierRules.showGuestTags) &&
  flag(left.cashierRules.allowTagging) === flag(right.cashierRules.allowTagging)
