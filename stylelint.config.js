// Colors, radii, shadows and fonts only through design tokens (CLAUDE.md 3.1, 10).
// tokens.css is the single place where raw values live. Raw colors are banned in any
// property and inside any function (hex, named colors, rgb()/oklch()/...), and
// radii, shadows and font families must be a var(--…) or a function of one.
const RAW_COLOR_FUNCTIONS = [
  'rgb',
  'rgba',
  'hsl',
  'hsla',
  'hwb',
  'lab',
  'lch',
  'oklab',
  'oklch',
  'color',
];

export default {
  extends: ['stylelint-config-standard'],
  plugins: ['stylelint-declaration-strict-value'],
  rules: {
    'selector-class-pattern': null,
    'custom-property-pattern': null,
    'keyframes-name-pattern': null,
    // Tokens are copied verbatim from the design reference (oklch(0.925 0.014 258)).
    'lightness-notation': null,
    'hue-degree-notation': null,
    'color-no-hex': true,
    'color-named': 'never',
    'function-disallowed-list': RAW_COLOR_FUNCTIONS,
    'property-disallowed-list': ['font'],
    'scale-unlimited/declaration-strict-value': [
      ['/radius$/', 'box-shadow', 'text-shadow', 'font-family'],
      {
        ignoreValues: ['none', 'inherit', 'initial', 'unset', '0', '50%'],
        ignoreFunctions: true,
        disableFix: true,
      },
    ],
  },
  overrides: [
    {
      files: ['apps/web/src/design/tokens.css'],
      rules: {
        'scale-unlimited/declaration-strict-value': null,
        'color-no-hex': null,
        'color-named': null,
        'function-disallowed-list': null,
        'property-disallowed-list': null,
      },
    },
  ],
};
