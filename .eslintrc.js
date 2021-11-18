module.exports = {
  root: true,
  env: {
    browser: true,
    node: true
  },
  ignorePatterns: [
    '**/dist/**',
    '**coverage**'
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: [
      './packages/aspen-core/tsconfig.json',
      './packages/react-aspen/tsconfig.json'
    ]
  },
  plugins: [
    '@typescript-eslint',
    'import'
  ],
  extends: [
    'plugin:@typescript-eslint/recommended',
    'plugin:import/errors',
    'plugin:import/warnings',
    'plugin:import/typescript'
  ],
  rules: {
    'semi': 'error',
    'eol-last': ['error', 'always'],
    'quotes': ['error', 'single', { 'avoidEscape': true, 'allowTemplateLiterals': true }],
    'comma-dangle': ['error', {
      'imports': 'never',
      'exports': 'never',
      'arrays': 'only-multiline',
      'objects': 'only-multiline',
      'functions': 'never'
    }],
    'import/order': ['error', {
      'groups': [['builtin', 'external'], ['internal', 'parent', 'sibling', 'index']]
    }],
    'import/newline-after-import': 'error',
    'import/named': 'off',
    'import/default': 'off',
    'no-shadow': 'off',
    'no-multiple-empty-lines': 2,
    'no-multi-spaces': 'error',
    'no-trailing-spaces': 'error',
    'no-extra-semi': 'error',
    'no-extend-native': 'error',
    'no-unneeded-ternary': 'error',
    'arrow-spacing': 'error',
    'prefer-object-spread': 'error',
    'prefer-const': 'error',
    'prefer-destructuring': ['error', { 'object': true, 'array': false }],
    'prefer-spread': 'error',
    'prefer-rest-params': 'error',
    '@typescript-eslint/indent': ['error', 2],
    '@typescript-eslint/no-useless-constructor': 'error',
    '@typescript-eslint/explicit-function-return-type': 'error',
    '@typescript-eslint/explicit-module-boundary-types': 0,
    '@typescript-eslint/camelcase': 'off',
    '@typescript-eslint/explicit-member-accessibility': 'off',
    '@typescript-eslint/ban-types': 'off',
    '@typescript-eslint/no-empty-function': 'off',
    '@typescript-eslint/no-shadow': 'error',
    '@typescript-eslint/prefer-nullish-coalescing': 'error',
    '@typescript-eslint/prefer-optional-chain': 'error',
    '@typescript-eslint/switch-exhaustiveness-check': 'error',
    '@typescript-eslint/consistent-type-definitions': ['error', 'type']
  },
  'settings': {
    'import/resolver': {
      'typescript': {}
    }
  }
};
