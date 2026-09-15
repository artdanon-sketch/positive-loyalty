/**
 * Деньги на экране гостя. Хранение и расчёты — целые в сатангах (CLAUDE.md,
 * железное правило 4); в баты сумма превращается только здесь, на выводе.
 *
 * Локаль фиксирована: цифры карты не должны прыгать при смене языка.
 */
const bahtFormat = new Intl.NumberFormat('ru-RU', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** 12 000 сатангов → «120,00 ฿». */
export const formatBaht = (minor: number): string => `${bahtFormat.format(minor / 100)} ฿`
