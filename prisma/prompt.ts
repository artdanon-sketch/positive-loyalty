/**
 * Вопросы в терминале для скриптов, которые заводят входы: `provision.ts`
 * и `demo-venue.ts`. Один исходник — чтобы скрытый ввод пароля не разошёлся
 * между ними: у второй копии однажды снова оказался бы пароль на экране.
 */

const out = process.stdout
const say = (s = ''): void => void out.write(`${s}\n`)

/** Обычный видимый ввод строки — для почты: она не секрет. */
export const askLine = async (prompt: string): Promise<string> => {
  const { createInterface } = await import('node:readline/promises')
  const rl = createInterface({ input: process.stdin, output: out })
  try {
    return await rl.question(prompt)
  } finally {
    rl.close()
  }
}

/**
 * Скрытый ввод.
 *
 * Тот же приём, что и в настройке Supabase, и по той же причине: подмена
 * внутреннего метода readline на живой машине не сработала, и вставленный
 * секрет оказался на экране. Читаем посимвольно сами.
 */
export const askHidden = (prompt: string): Promise<string> =>
  new Promise((resolve) => {
    const stdin = process.stdin

    if (typeof stdin.setRawMode !== 'function') {
      say('')
      say('✗ Эту команду нужно запускать в обычном окне терминала: она задаёт вопрос.')
      say('')
      process.exit(1)
    }

    out.write(prompt)

    const wasRaw = stdin.isRaw === true
    stdin.setRawMode(true)
    stdin.resume()
    stdin.setEncoding('utf8')

    let value = ''
    let inEscape = false

    const finish = (done: () => void): void => {
      stdin.off('data', onData)
      stdin.setRawMode(wasRaw)
      stdin.pause()
      done()
    }

    const onData = (chunk: string): void => {
      for (const ch of chunk) {
        if (inEscape) {
          if (/[A-Za-z~]/.test(ch)) inEscape = false
          continue
        }

        if (ch === '\u001b') {
          inEscape = true
          continue
        }

        if (ch === '\r' || ch === '\n') {
          out.write('\n')
          finish(() => resolve(value))
          return
        }

        if (ch === '\u0003') {
          out.write('\n')
          finish(() => {
            say('')
            say('Отменено. Ничего не создано.')
            say('')
            process.exit(130)
          })
          return
        }

        if (ch === '\u007f' || ch === '\b') {
          if (value.length > 0) {
            value = value.slice(0, -1)
            out.write('\b \b')
          }
          continue
        }

        if (ch < ' ') continue

        value += ch
        out.write('*')
      }
    }

    stdin.on('data', onData)
  })
