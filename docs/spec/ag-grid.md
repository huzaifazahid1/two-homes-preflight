# AG Grid

Part of the Two Homes Preflight spec. Source sections: K. Read `CLAUDE.md` first; it maps section letters to files.

# K. AG Grid [Agreed: Community edition only]

## K.1 Where

| Screen | Grid | Phone alternative |
| --- | --- | --- |
| `/app/ledger` | Full ledger | Card list grouped by month |
| `/app/expenses` (>= 1024 px) | Expense table with live status | Card list |
| `/app` dashboard (>= 1024 px) | "Needs your action" and "Recent claims" compact grids | Cards |
| `/app/money` (>= 1024 px) | Outstanding / overdue / closed | Cards with segmented filter |

Small static lists (rules review, billing history, timeline) use plain components, not AG Grid.

## K.2 Setup

- Packages `ag-grid-community` + `ag-grid-react` 36.3.0. Register once in `src/components/grid/register.ts`: `ModuleRegistry.registerModules([AllCommunityModule])`. Never install or import `ag-grid-enterprise`.
- Theme: `themeQuartz.withParams({...})` fed from our CSS variables (font, colors, row height 48, header height 44, border radius). Separate params for dark mode, switched by the theme provider.
- Grid components are client components (`'use client'`) receiving rows from a Server Component or from `GET /api/ledger`.

## K.3 Ledger columns

| Column | Renderer / config |
| --- | --- |
| Date | date formatter (user time zone), sortable, date filter |
| Child | text filter |
| Description + vendor | two-line cell renderer |
| Category | text filter |
| Clause | `ClauseCell`: short quote + "p. 4" chip, click opens source sheet |
| Verdict | `VerdictBadge` renderer |
| Approval | `StatusBadge` |
| Settlement | `StatusBadge` with derived overdue ("Overdue 5d") |
| Total | Geist Mono, right aligned, number filter on cents with USD formatter |
| Owed | same |
| Owed by | text |
| Due | date, highlights overdue |
| Actions | button renderer (open, remind) respecting authorization |

## K.4 Features used (all Community)
Sorting (multi-column), column filters (text, number, date), quick filter (search box), external filter (Overdue only, Owed to me, per child), pagination (page size 25, client-side row model), row selection (`rowSelection: { mode: 'multiRow' }`) used only for **CSV export of selected rows**, CSV export (`api.exportDataAsCsv`), pinned bottom row for totals (computed by the server, not by the grid), column pinning (first column) and resizing, `getRowId` = expense id so live updates keep selection, `domLayout: 'autoHeight'` for compact dashboard grids.

## K.5 Not available in Community (do not use)
Excel export, row grouping and aggregation, pivoting, set filter, master/detail, server-side row model, integrated charts, range selection/clipboard. Grouping by month is done with a Month column and sorting.

## K.6 Data
The server returns rows with display-ready derived fields (`isOverdue`, `daysOverdue`, `owedCents`, clause snippet). The grid never computes money or status.
