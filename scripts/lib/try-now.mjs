/**
 * When a tool page shows a copy-paste install command.
 *
 * Catalog overlay is the trust signal: project.install exists only if this
 * organization owns the package. Registry membership used to proxy that
 * question and hid 48 of 55 catalog-verified commands.
 */
export function shouldShowInstall(project) {
  return Boolean(project && project.install);
}

export function shouldMountTryItNow(project, toolProof) {
  return shouldShowInstall(project) || Boolean(toolProof);
}
