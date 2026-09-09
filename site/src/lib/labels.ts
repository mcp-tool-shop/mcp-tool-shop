/**
 * Human-readable labels for catalog facets.
 *
 * Kept out of the pages so the tools index, the homepage and the tool
 * detail page render the same vocabulary.
 */

const KIND_LABELS: Record<string, string> = {
  'mcp-server': 'MCP server',
  cli: 'CLI',
  library: 'Library',
  plugin: 'Plugin',
  'desktop-app': 'Desktop app',
  'vscode-extension': 'VS Code extension',
  'homebrew-tap': 'Homebrew tap',
  template: 'Template',
  meta: 'Org infrastructure',
};

const LANE_LABELS: Record<string, string> = {
  shipped: 'Shipped',
  active_lab: 'In development',
  internal: 'Internal',
  seed_vault: 'Archive',
};

export function kindLabel(kind?: string): string {
  if (!kind) return '';
  return KIND_LABELS[kind] ?? kind;
}

export function laneLabel(lane?: string): string {
  if (!lane) return '';
  return LANE_LABELS[lane] ?? lane;
}

/** Which package ecosystem an install command targets. */
export function ecosystemOf(install?: string): string {
  if (!install) return '';
  const cmd = install.trim();
  if (/^(npx|npm|pnpm|yarn)\b/.test(cmd)) return 'npm';
  if (/^(pip|pipx|uv|uvx|python)\b/.test(cmd)) return 'PyPI';
  if (/^cargo\b/.test(cmd)) return 'Cargo';
  if (/^dotnet\b/.test(cmd)) return '.NET';
  if (/^(docker|podman)\b/.test(cmd)) return 'Container';
  if (/^brew\b/.test(cmd)) return 'Homebrew';
  return 'Other';
}

/** Absolute date, stable between builds (unlike "3d ago"). */
export function shortDate(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

/** Relative date for very recent items (release strips). */
export function relativeDate(iso?: string): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? '1mo ago' : `${months}mo ago`;
}

/** Strip markdown residue from a release-note line. */
export function plainText(s: string): string {
  return s
    .replace(/^[>\s]+/, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\*\*/g, '')
    .replace(/__/g, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The catalog as /tools/ renders it. Registry entries whose repository no
 * longer exists carry no GitHub data — they are catalog ghosts, not tools.
 */
export function catalogTools<T extends { updatedAt?: string }>(projects: T[]): T[] {
  return projects.filter((p) => p.updatedAt);
}

/**
 * The default /tools/ view: shipped and in-development repositories. Shared so
 * that any page quoting "browse all N tools" quotes the number /tools/ shows;
 * start.astro previously hardcoded it and drifted.
 */
export function isDefaultTool(p: any): boolean {
  return (
    !p.deprecated &&
    (p.lane === 'shipped' || p.lane === 'active_lab' || (p.registered && !p.lane))
  );
}

export function defaultToolCount(projects: any[]): number {
  return catalogTools(projects).filter(isDefaultTool).length;
}
