// Layer boundaries from CLAUDE.md 3.1. A violation fails `pnpm lint`.
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
    {
      name: 'shared-is-standalone',
      comment: 'packages/shared must not import apps/* or scripts.',
      severity: 'error',
      from: { path: '^packages/shared/' },
      to: { path: '^(apps|scripts|e2e)/' },
    },
    {
      name: 'shared-no-node-builtins',
      comment: 'packages/shared is platform-neutral: no Node API.',
      severity: 'error',
      from: { path: '^packages/shared/src/', pathNot: '\\.test\\.ts$' },
      to: { dependencyTypes: ['core'] },
    },
    {
      name: 'shared-only-zod',
      comment: 'packages/shared depends only on zod.',
      severity: 'error',
      from: { path: '^packages/shared/src/', pathNot: '\\.test\\.ts$' },
      to: {
        dependencyTypes: [
          'npm',
          'npm-dev',
          'npm-peer',
          'npm-optional',
          'npm-no-pkg',
          'npm-unknown',
        ],
        pathNot: '/zod/',
      },
    },
    {
      name: 'web-not-server',
      severity: 'error',
      from: { path: '^apps/web/' },
      to: { path: '^apps/server/' },
    },
    {
      name: 'server-not-web',
      severity: 'error',
      from: { path: '^apps/server/' },
      to: { path: '^apps/web/' },
    },
    {
      name: 'shared-via-index-only',
      comment: 'Import @funnel/shared only through its index.ts.',
      severity: 'error',
      from: { pathNot: '^packages/shared/' },
      to: { path: '^packages/shared/src/', pathNot: '^packages/shared/src/index\\.ts$' },
    },
    {
      name: 'routes-not-repo-or-db',
      comment: 'Server layering: routes -> service -> repo -> db.',
      severity: 'error',
      from: { path: '^apps/server/src/modules/[^/]+/routes\\.ts$' },
      to: { path: '^apps/server/src/(db/|modules/[^/]+/repo\\.ts$)' },
    },
    {
      name: 'service-not-routes',
      severity: 'error',
      from: { path: '^apps/server/src/modules/[^/]+/service\\.ts$' },
      to: { path: '^apps/server/src/modules/[^/]+/routes\\.ts$' },
    },
    {
      name: 'repo-not-service-or-http',
      comment: 'Repositories know nothing about HTTP or business services.',
      severity: 'error',
      from: { path: '^apps/server/src/modules/[^/]+/repo\\.ts$' },
      to: {
        path: '(^apps/server/src/modules/[^/]+/(routes|service)\\.ts$|/node_modules/(fastify|@fastify)/)',
      },
    },
    {
      name: 'ui-is-dumb',
      comment: 'ui/* knows nothing about features or the API client.',
      severity: 'error',
      from: { path: '^apps/web/src/ui/' },
      to: { path: '^apps/web/src/(features|lib/api)' },
    },
    {
      name: 'features-isolated',
      comment: 'A feature does not import internals of another feature.',
      severity: 'error',
      from: { path: '^apps/web/src/features/([^/]+)/' },
      to: { path: '^apps/web/src/features/', pathNot: '^apps/web/src/features/$1/' },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(node_modules|dist|coverage)' },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    tsConfig: { fileName: 'tsconfig.depcruise.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'default', 'node'],
      extensions: ['.ts', '.tsx', '.js', '.json'],
    },
  },
};
