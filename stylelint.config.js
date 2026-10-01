// Colors, radii, shadows and fonts only through design tokens (CLAUDE.md 3.1, 10).
// tokens.css is the single place where raw values live.
export default {
  extends: ['stylelint-config-standard'],
  plugins: ['stylelint-declaration-strict-value'],
  rules: {
    'selector-class-pattern': null,
    'custom-property-pattern': null,
    'keyframes-name-pattern': null,
    'scale-unlimited/declaration-strict-value': [
      ['/color$/', 'fill', 'stroke', 'border-radius', 'box-shadow', 'font-family', 'background'],
      {
        ignoreValues: [
          'transparent',
          'currentcolor',
          'currentColor',
          'inherit',
          'none',
          'initial',
          'unset',
          '0',
          '50%',
        ],
        ignoreFunctions: true,
        disableFix: true,
      },
    ],
  },
  overrides: [
    {
      files: ['apps/web/src/design/tokens.css'],
      rules: { 'scale-unlimited/declaration-strict-value': null },
    },
  ],
};
