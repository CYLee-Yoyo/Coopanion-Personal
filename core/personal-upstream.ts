/** Public upstream baseline and the personal features that require review during an upgrade. */
export const UPSTREAM_BASE = {
  version: '0.2.3', commit: '6ddb1341befea9bad94bb48ed5b1cb998da77fd1',
  corticoCommit: '786b79a98041a8d93f6b53b4eb1b86fe71240151',
} as const;

export const PERSONAL_FEATURES = [
  { id: 'subscription', paths: ['packages/cortico-provider-coo/src/chatgpt/', 'packages/cortico-provider-coo/src/connect.ts', 'core/chatgpt-session.ts', 'core/companion.ts'], description: 'ChatGPT subscription transport, complete streamed responses, transport metadata filtering and no paid API fallback. Each inference is attempted once; any subscription failure pauses delivery and interrupts the current round to prevent Core resubmission. Recovery and failed-release analysis retries require explicit user actions.' },
  { id: 'credentials', paths: ['app/chatgpt-auth.cjs', 'app/main.cjs', 'core/chatgpt-session.ts'], description: 'Encrypted credentials in Electron main, private IPC, cancellation and sign-out guards, and rejection of redirects and raw error bodies.' },
  { id: 'models', paths: ['console/features/home/', 'console/companion.css', 'console/base/'], description: 'Immediate model persistence, account-specific catalog, themed model popup, and readable primary-button text.' },
  { id: 'computerUse', paths: ['console/features/cua/', 'console/features/pet/', 'packages/cortico-world-desktop-pet/src/cua/',
    'packages/cortico-world-desktop-pet/host/', 'packages/cortico-world-desktop-pet/web/kit/', 'packages/cortico-world-desktop-pet/web/pet-app.js',
    'packages/cortico-world-desktop-pet/web/whale/figure.js', 'packages/cortico-world-desktop-pet/src/ENV_PROMPT',
    'packages/cortico-world-desktop-pet/src/config.ts', 'packages/cortico-world-desktop-pet/src/world.ts'],
    description: 'Computer-use settings refresh current tools and prompts while preserving history and consent. Window-top movement reads geometry only, follows moving windows, supports manual drops, upward jumps, side-edge climbing, outward hops down and jumps between nearby windows on the same display. Window departures approach an edge and revalidate takeoff and the target after window changes; inter-window jumps reject obstructed or unreachable routes. Settings apply immediately; movement never moves other windows or changes focus. Dialogs, listening and quiet mode cancel climbing and departure preparation; lost or blocked climbing edges release the pet, and airborne jumps finish landing.' },
  { id: 'isolation', paths: ['app/', 'core/personal-seed.ts', 'core/telemetry.ts', 'scripts/', 'electron-builder.yml', 'package.json'], description: 'Separate installation and data, a pinned physical Windows data directory shared by launch contexts, disabled telemetry, no automatic installation, and reviewed source backups to the operator fork with upstream pushes disabled.' },
  { id: 'tracking', paths: ['core/upstream-', 'core/personal-upstream.ts', 'console/features/updates/', 'console/features/release.ts', 'core/notice.ts', 'core/companion.ts'], description: 'Six-hour public release checks, subscription-only review, one report per release, pet notification and a saved request for manual integration.' },
] as const;

export type PersonalFeatureId = (typeof PERSONAL_FEATURES)[number]['id'];

export function featureOverlaps(files: readonly { path: string; previousPath?: string }[]): PersonalFeatureId[] {
  return PERSONAL_FEATURES.filter(feature => files.some(file => feature.paths.some(prefix =>
    file.path.startsWith(prefix) || file.previousPath?.startsWith(prefix)))).map(feature => feature.id);
}
