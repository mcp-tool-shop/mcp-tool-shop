# Screenshot Contract

Every "front-door" (public) tool listed on the site must have an accompanying screenshot at:

`site/public/screenshots/<slug>.png`

## Requirements

1.  **Dimensions**: `1280px` wide x `640px` tall (2:1 aspect ratio)
2.  **Format**: PNG
3.  **Content**:
    *   **Tool Name**: Prominently displayed (top-left preferred)
    *   **Promise**: One-line purpose statement (e.g., "Find tools fast")
    *   **Command**: The *exact command* a user types
    *   **Output**: The first 3-5 lines of meaningful output (success case)
    *   **Visual Proof** (Optional): Passing tests badge, version number, or visual indicator (green checkmark)
4.  **Style**:
    *   Clean terminal theme (e.g., VS Code "Dark Modern")
    *   Sans-serif font (Cascadia Code, Fira Code, Consolas)
    *   No broken links or "Error: command not found" visible

## Example (mcpt)

*   **Command**: `mcpt search "accessibility"`
*   **Output**: 
    ```
    Found 3 tools:
    - accessibility-suite (A11Y compliance monorepo)
    - ally-demo-python (Reference implementation)
    ...
    ```

## Placeholders

If a tool is not ready for a real screenshot, use a placeholder.
The override data must set `"screenshotType": "placeholder"` in `site/src/data/overrides.json`.

Placeholders should still render cleanly and state "Image Coming Soon" or similar clear indicator.

## Verification

Run the local verification script to check your work:

```bash
node scripts/verify-site-images.mjs
```
