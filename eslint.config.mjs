// ─────────────────────────────────────────────────────────────────────────────
// Единственный конфиг линтера на весь монорепо.
// Отдельных eslint.config.* в пакетах нет и не должно быть: правило, которое
// живёт в семи местах, через месяц расходится в семи направлениях.
//
// Слои конфига, снизу вверх:
//   1. игнор — то, что не наш код;
//   2. база JS для всего;
//   3. TypeScript с типами — для исходников приложений и пакетов;
//   4. TypeScript без типов — для конфигов сборки, которых нет ни в одном tsconfig;
//   5. React — только для фронтов;
//   6. послабления для тестов;
//   7. prettier — последним, он снимает правила форматирования.
// ─────────────────────────────────────────────────────────────────────────────
import js from '@eslint/js'
import prettier from 'eslint-config-prettier/flat'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/** Конфиги сборщиков, тест-раннеров и CLI: код на TypeScript, но не приложение. */
const TOOLING_FILES = [
  '**/vite.config.ts',
  '**/vitest.config.ts',
  '**/*.config.mts',
  // Конфиг Prisma CLI лежит в корне и ни в один tsconfig не входит:
  // типизированный линт на нём падает с «not found by the project service».
  'prisma.config.ts',
  // Конфигурации Capacitor лежат в пакетах-оболочках без своего tsconfig:
  // это описание сборки, а не код приложения. Типизированный линт спотыкался
  // бы о них ровно так же, как о prisma.config.ts.
  'apps/mobile/*/capacitor.config.ts',
]

/** Тесты: и юнит, и e2e, и файлы подготовки окружения. */
const TEST_FILES = [
  '**/*.test.{ts,tsx}',
  '**/*.spec.ts',
  '**/*.e2e-spec.ts',
  '**/test/setup.ts',
  '**/vitest.setup.ts',
]

const FRONTEND_FILES = ['apps/admin/src/**/*.{ts,tsx}', 'apps/guest/src/**/*.{ts,tsx}']

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      // Мобильные сборки кладутся в dist-owner, dist-cashier, dist-native:
      // тот же собранный код, только под другим именем каталога.
      '**/dist-*/**',
      '**/build/**',
      '**/coverage/**',
      '**/.vite/**',
      '**/.wrangler/**',
      'docs/**',
      'pnpm-lock.yaml',
      // Клиент Prisma собирается генератором из prisma/schema.prisma.
      // Файлы помечены @ts-nocheck и eslint-disable самим генератором;
      // линтить их — тратить время CI на чужой код.
      '**/generated/prisma/**',
      // Нативные проекты Android создаёт Capacitor: Java, Gradle и его же
      // шаблоны. Наш там только AndroidManifest, и правила JS к нему не
      // относятся. Собранная веб-часть в www/ — копия dist, её уже проверили.
      'apps/mobile/*/android/**',
      'apps/mobile/*/www/**',
    ],
  },

  // ── 2. База ────────────────────────────────────────────────────────────────
  js.configs.recommended,
  {
    rules: {
      // CLAUDE.md: «Оставлять console.log в коде — есть логгер».
      // Логи пишет логгер сервиса, а не глобальный console.
      'no-console': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-var': 'error',
      'prefer-const': 'error',
      'object-shorthand': ['error', 'properties'],
    },
  },

  // ── 3. TypeScript с типами ─────────────────────────────────────────────────
  {
    files: ['**/*.{ts,tsx}'],
    ignores: TOOLING_FILES,
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        // projectService сам находит ближайший tsconfig.json — не нужно перечислять
        // семь проектов руками и держать список в актуальном состоянии.
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Про необъявленные имена в TypeScript знает компилятор, и знает точнее:
      // no-undef в TS даёт ложные срабатывания на типах и глобалах окружения.
      'no-undef': 'off',
      // CLAUDE.md, «Что делать нельзя»: типизацию не отключаем.
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },

  // ── 4. TypeScript без типов — конфиги инструментов ─────────────────────────
  // vite.config.ts и vitest.config.ts не входят в tsconfig.json своих приложений
  // (там лежат отдельные tsconfig.node.json), и projectService на них спотыкается.
  // Правильный ответ — сузить область type-aware правил, а не рассыпать по файлам
  // eslint-disable и не выключать правила целиком.
  {
    files: TOOLING_FILES,
    extends: [tseslint.configs.recommended],
    languageOptions: {
      globals: globals.node,
    },
    rules: {
      'no-undef': 'off',
    },
  },

  // ── 5. Окружения ───────────────────────────────────────────────────────────
  {
    files: ['apps/api/**/*.ts', 'apps/worker/**/*.ts', 'packages/contracts/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    // Скрипты сборки мобильных оболочек: обычный node, а не браузер.
    files: ['apps/mobile/*/scripts/*.mjs'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['apps/admin/**/*.{ts,tsx}', 'apps/guest/**/*.{ts,tsx}', 'packages/ui/**/*.ts'],
    languageOptions: { globals: globals.browser },
  },

  // ── 6. React ───────────────────────────────────────────────────────────────
  {
    files: FRONTEND_FILES,
    extends: [reactHooks.configs.flat['recommended-latest']],
  },
  {
    files: ['apps/admin/src/**/*.tsx', 'apps/guest/src/**/*.tsx'],
    extends: [reactRefresh.configs.vite],
  },

  // ── 7. Тесты ───────────────────────────────────────────────────────────────
  {
    files: TEST_FILES,
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      // В тестах заглушки намеренно неполные: `as unknown as MediaQueryList`
      // вместо честной реализации интерфейса — это осознанное сужение, а не дыра.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      // Метод, оторванный от объекта, в expect(...) — нормальная запись, а не ошибка.
      '@typescript-eslint/unbound-method': 'off',
    },
  },

  // ── 8. Prettier ────────────────────────────────────────────────────────────
  prettier,
)
