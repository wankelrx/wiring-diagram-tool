# Wiring Diagram Tool

Browser app that turns connector and wire tables into an engineering-style pin-to-pin harness drawing. Import spreadsheets, edit the tables, and export SVG, PNG, PDF, DXF, or a wire list.

## Run

```bash
npm install
npm run dev
```

Open http://localhost:5173/. The current drawing autosaves in the browser. Use **Sample** to restore the demo harness.

```bash
npm test
npm run build
npm run lint
```

## Spreadsheet format

Download **Download template** for a starter workbook. Files can be `.xlsx` or `.csv`. Multiple files merge by `connector_id` / `wire_id` (later rows overwrite the same ID). Imports larger than 8 MB are rejected.

**Connectors**

| Column | Required | Notes |
| --- | --- | --- |
| `connector_id` | yes | Unique |
| `connector_name` | yes | Shown on the box |
| `pin_count` | yes | Numeric pins `1…n` |
| `position_x` / `position_y` | no | Manual placement |

**Wires**

| Column | Required | Notes |
| --- | --- | --- |
| `wire_id` | yes | Unique |
| `from_connector` / `from_pin` | yes | Empty pins are errors |
| `to_connector` / `to_pin` | yes | |
| `wire_color` | yes | Name or `#rrggbb` |
| `gauge` | yes | |
| `signal_name` | no | |
| `twist_group` | no | Same value braids those wires |
| `shield_group` | no | Draws a dashed shield tube |

Alphanumeric pins (for example `A` or `SH`) are extra contacts beyond `pin_count`. Numeric pins outside `1…pin_count` stay invalid and draw as dashed ERROR stubs instead of disappearing.

## Diagram

- Orthogonal pin-to-pin routes; twisted pairs share one braid centerline
- Shields as dashed tubes; cable IDs are labels only (wires stay visible)
- Duplicate pins, missing refs, and blank/duplicate IDs are listed under the canvas
- Drag the sheet to pan; use the canvas `+` / `−` / Fit controls or `F` / `0`
- Undo / Redo in the toolbar (`⌘Z` / `Ctrl+Z` when the canvas is focused)
- Fill **Drawing** fields (title, DWG no, rev, date, by, notes) for the title block

## Export

PDF, SVG, PNG, and DXF are named from the drawing number and revision (for example `WD-001-revA.pdf`). They include:

- The wiring drawing with an engineering title block
- A pinout table per connector
- A full wire list

Use **Export → PDF (print sheet)** for build documentation. Exports warn if the dataset still has validation errors.
