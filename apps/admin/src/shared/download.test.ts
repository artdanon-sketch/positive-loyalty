import { afterEach, describe, expect, it, vi } from 'vitest'

import { saveTextFile } from './download'

const readBytes = async (blob: Blob): Promise<number[]> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      resolve([...new Uint8Array(reader.result as ArrayBuffer)])
    }
    reader.onerror = () => {
      reject(reader.error ?? new Error('Файл не прочитался'))
    }
    reader.readAsArrayBuffer(blob)
  })

const UTF8_BOM = [0xef, 0xbb, 0xbf]

describe('Сохранение файла', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('BOM ВОЗВРАЩАЕТСЯ В ФАЙЛ: БРАУЗЕР СРЕЗАЛ ЕГО, ЧИТАЯ ОТВЕТ, А EXCEL БЕЗ НЕГО ПОКАЖЕТ КРАКОЗЯБРЫ', async () => {
    const blobs: Blob[] = []
    Object.defineProperty(URL, 'createObjectURL', {
      value: (blob: Blob) => {
        blobs.push(blob)
        return 'blob:guests'
      },
      configurable: true,
      writable: true,
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: () => undefined,
      configurable: true,
      writable: true,
    })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)

    expect(saveTextFile('Имя', 'guests.csv', { type: 'text/csv', bom: true })).toBe(true)
    expect(click).toHaveBeenCalledTimes(1)
    expect((await readBytes(blobs[0] as Blob)).slice(0, 3)).toEqual(UTF8_BOM)

    // Текст уже с BOM — второй не добавляется.
    saveTextFile(`${String.fromCharCode(0xfeff)}Имя`, 'guests.csv', { type: 'text/csv', bom: true })
    const again = await readBytes(blobs[1] as Blob)

    expect(again.slice(0, 3)).toEqual(UTF8_BOM)
    expect(again.slice(3, 6)).not.toEqual(UTF8_BOM)
  })

  it('без ссылок на Blob — честное false, а не падение', () => {
    Object.defineProperty(URL, 'createObjectURL', {
      value: undefined,
      configurable: true,
      writable: true,
    })

    expect(saveTextFile('x', 'x.txt', { type: 'text/plain', bom: false })).toBe(false)
  })
})
