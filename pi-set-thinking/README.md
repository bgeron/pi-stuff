# `@bramgeron/pi-set-thinking`

Cycle Pi's thinking level backward with Alt+Shift+Tab. Pi's native Shift+Tab shortcut continues to cycle forward.

The shortcut wraps around and skips levels unsupported by the active model. For example, pressing Alt+Shift+Tab at `off` selects the model's highest supported thinking level.

Your terminal must report Alt+Shift+Tab to Pi rather than intercepting it as a desktop or terminal shortcut.

Requires Pi 0.79.0 or newer.

## Local usage

Load this package from the repository root:

```bash
pi -e ./pi-set-thinking
```
