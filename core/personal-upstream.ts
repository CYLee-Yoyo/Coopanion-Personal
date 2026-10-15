/** Public upstream baseline and the personal features that require review during an upgrade. */
export const UPSTREAM_BASE = {
  version: '0.1.27', commit: '65c944667a4874d6eacee08ea7252b4afd64f159',
  corticoCommit: '9469daf42cd427b230441a80219b0466dc02488c',
} as const;

export const PERSONAL_FEATURES = [
  { id: 'subscription', paths: ['packages/cortico-provider-coo/src/chatgpt/', 'packages/cortico-provider-coo/src/connect.ts', 'core/chatgpt-session.ts'], description: 'ChatGPT subscription transport, complete streamed responses, no paid API fallback, and stopping on quota or authorization failure.' },
  { id: 'credentials', paths: ['app/chatgpt-auth.cjs', 'app/main.cjs', 'core/chatgpt-session.ts'], description: 'Encrypted credentials in Electron main, private IPC, cancellation and sign-out guards, and rejection of redirects and raw error bodies.' },
  { id: 'models', paths: ['console/features/home/', 'console/companion.css', 'console/base/'], description: 'Immediate model persistence, account-specific catalog, themed model popup, and readable primary-button text.' },
  { id: 'computerUse', paths: ['console/features/cua/', 'packages/cortico-world-desktop-pet/src/cua/'], description: 'Computer-use settings refresh the current tools and prompt while preserving conversation history and consent settings.' },
  { id: 'isolation', paths: ['app/', 'core/personal-seed.ts', 'core/telemetry.ts', 'scripts/', 'electron-builder.yml', 'package.json'], description: 'Separate installation and data, disabled telemetry, no automatic installation, and reviewed source backups to the operator fork with upstream pushes disabled.' },
  { id: 'tracking', paths: ['core/upstream-', 'core/personal-upstream.ts', 'console/features/updates/', 'console/features/release.ts', 'core/notice.ts', 'core/companion.ts'], description: 'Six-hour public release checks, subscription-only review, one report per release, pet notification and a saved request for manual integration.' },
] as const;

export type PersonalFeatureId = (typeof PERSONAL_FEATURES)[number]['id'];

export function featureOverlaps(files: readonly { path: string; previousPath?: string }[]): PersonalFeatureId[] {
  return PERSONAL_FEATURES.filter(feature => files.some(file => feature.paths.some(prefix =>
    file.path.startsWith(prefix) || file.previousPath?.startsWith(prefix)))).map(feature => feature.id);
}
