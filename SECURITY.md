# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 0.1.x (latest) | Yes |
| < 0.1.0 | No |

Only the latest minor release receives security fixes.

## Dependency Posture

`@mcptoolshop/promo-kit` has **zero runtime dependencies**. There is nothing to audit beyond the package itself. All functionality uses Node.js built-in modules (`fs`, `path`, `crypto`, `child_process`).

## Data Handling

- All data stays local — no network calls, no telemetry, no external services
- Artifacts are hashed with SHA-256 for integrity verification
- No secrets, tokens, or credentials are read or stored by the kit

## Reporting a Vulnerability

If you discover a security issue, please report it privately:

1. **Email**: [64996768+mcp-tool-shop@users.noreply.github.com](mailto:64996768+mcp-tool-shop@users.noreply.github.com)
2. **Subject**: `[SECURITY] promo-kit — brief description`

Please include:
- Description of the vulnerability
- Steps to reproduce
- Impact assessment (if known)

We aim to acknowledge reports within 48 hours and provide a fix timeline within 7 days.

**Do not** open a public GitHub issue for security vulnerabilities.
