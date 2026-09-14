/**
 * Подставить значения в строку перевода: «Код живёт {days} дн.» → «Код живёт 14 дн.».
 *
 * Фразы собираются из переводов, а не склеиваются в коде: порядок слов
 * в английском и русском разный, и склейка «За » + trigger + « у » + partner
 * сломала бы второй язык.
 *
 * Неизвестный ключ остаётся в строке как есть: пропущенное значение видно
 * глазом на экране, а не превращается в «undefined».
 */
export const fill = (template: string, values: Readonly<Record<string, string | number>>): string =>
  template.replace(/\{(\w+)\}/g, (match: string, key: string) => {
    const value = values[key]
    return value === undefined ? match : String(value)
  })
