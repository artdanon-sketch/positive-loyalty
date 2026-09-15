/**
 * Сохранить текст файлом на устройстве пользователя.
 *
 * Через временную ссылку на Blob: файл собирается в браузере из уже полученного
 * ответа, повторно никуда не загружается и не оседает в истории адресов.
 *
 * BOM ДОБАВЛЯЕТСЯ ЗДЕСЬ. Браузер, читая ответ текстом, отбрасывает BOM, который
 * прислал сервер, — а без него Excel открывает UTF-8 кракозябрами.
 *
 * Возвращает false, если браузер не умеет ссылки на Blob: вызывающий решает,
 * что сказать человеку.
 */

const BOM = String.fromCharCode(0xfeff)

export const saveTextFile = (
  text: string,
  filename: string,
  options: { readonly type: string; readonly bom: boolean },
): boolean => {
  if (typeof URL.createObjectURL !== 'function') {
    return false
  }

  const body = options.bom && !text.startsWith(BOM) ? `${BOM}${text}` : text
  const url = URL.createObjectURL(new Blob([body], { type: options.type }))
  const link = document.createElement('a')

  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)

  return true
}
