/**
 * Общие настройки prettier для всего монорепо.
 * Корневой prettier.config.mjs просто реэкспортирует этот объект.
 *
 * @type {import('prettier').Config}
 */
const config = {
  semi: false,
  singleQuote: true,
  printWidth: 100,
  trailingComma: 'all',
  tabWidth: 2,
  useTabs: false,
  arrowParens: 'always',
  bracketSpacing: true,
  jsxSingleQuote: false,
  quoteProps: 'as-needed',
  // Windows-машины в команде есть, а CI на Linux: без явного lf `format:check` краснеет
  // на файлах, сохранённых с CRLF.
  endOfLine: 'lf',
}

export default config
