"use client";

import type { ColDef, GridApi, IRowNode } from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { Download, Search } from "lucide-react";
import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { SourceSheet, type SourceTarget } from "@/components/domain/source-sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api, errorMessage } from "@/hooks/api";
import { useMediaQuery } from "@/hooks/use-media-query";
import { formatCents } from "@/lib/money";
import type { LedgerView } from "@/types/views";
import { ActionsCell, ApprovalCell, ClauseCell, DescriptionCell, MoneyCell, SettlementCell, VerdictCell, type GridRow, type TotalRow } from "./cells";
import { LedgerCards } from "./ledger-cards";
import { gridTheme } from "./theme";

// The ledger (Section K.1, K.3, K.4): AG Grid Community on desktop, a card list grouped by month
// on phones. Sorting, column filters, quick filter, external filters, pagination, multi-row
// selection for CSV export of selected rows, pinned totals row from the server, pinned first
// column, getRowId = expense id so live refreshes keep the selection.

type Filters = { overdueOnly: boolean; owedToMe: boolean; childId: string };

export function LedgerGrid({ view, onChanged }: { view: LedgerView; onChanged: () => void }) {
  const desktop = useMediaQuery("(min-width: 1024px)");
  const [quick, setQuick] = useState("");
  const [filters, setFilters] = useState<Filters>({ overdueOnly: false, owedToMe: false, childId: "" });
  const [source, setSource] = useState<SourceTarget>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const apiRef = useRef<GridApi<GridRow | TotalRow> | null>(null);
  // AG Grid calls doesExternalFilterPass outside React; it reads the latest filters from here.
  const filtersRef = useRef(filters);

  const tz = view.timeZone ?? undefined;
  const dateFmt = useMemo(() => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: tz }), [tz]);

  const remind = useCallback(
    async (id: string) => {
      setBusyId(id);
      try {
        await api(`/api/expenses/${id}/remind`, { method: "POST" });
        toast.success("Reminder sent");
        onChanged();
      } catch (e) {
        toast.error(errorMessage(e));
      } finally {
        setBusyId(null);
      }
    },
    [onChanged],
  );

  const columnDefs = useMemo<ColDef<GridRow | TotalRow>[]>(
    () => [
      {
        headerName: "Date", field: "date", pinned: "left", width: 130, sort: "desc", filter: "agDateColumnFilter",
        valueFormatter: (p) => (p.value ? dateFmt.format(new Date(p.value)) : ""),
        filterParams: { comparator: (filterDate: Date, cell: string | null) => (cell ? cmpDay(new Date(cell), filterDate) : -1) },
      },
      { headerName: "Month", field: "month", width: 110, filter: "agTextColumnFilter", hide: true },
      { headerName: "Child", field: "childName", width: 110, filter: "agTextColumnFilter" },
      { headerName: "Expense", field: "description", minWidth: 220, flex: 1.4, cellRenderer: DescriptionCell, filter: "agTextColumnFilter", getQuickFilterText: (p) => `${p.data?.description ?? ""} ${(p.data as GridRow)?.vendor ?? ""}` },
      { headerName: "Category", field: "category", width: 140, filter: "agTextColumnFilter", valueFormatter: (p) => (p.value ? String(p.value).replace(/_/g, " ") : "") },
      { headerName: "Clause", colId: "clause", minWidth: 220, flex: 1, cellRenderer: ClauseCell, sortable: false, valueGetter: (p) => (p.data && !p.data.isTotal ? p.data.clause?.quote ?? "" : "") },
      { headerName: "Verdict", field: "verdict", width: 170, cellRenderer: VerdictCell },
      { headerName: "Approval", field: "approval", width: 170, cellRenderer: ApprovalCell },
      { headerName: "Settlement", field: "settlement", width: 200, cellRenderer: SettlementCell },
      {
        headerName: "Total", field: "totalCents", width: 120, type: "rightAligned", cellRenderer: MoneyCell, filter: "agNumberColumnFilter",
        filterValueGetter: (p) => (p.data ? p.data.totalCents / 100 : null), filterParams: { buttons: ["reset"] },
      },
      {
        headerName: "Owed", field: "owedCents", width: 120, type: "rightAligned", cellRenderer: MoneyCell, filter: "agNumberColumnFilter",
        filterValueGetter: (p) => (p.data ? p.data.owedCents / 100 : null),
      },
      { headerName: "Owed by", field: "owedByName", width: 110, filter: "agTextColumnFilter" },
      {
        headerName: "Due", field: "dueAt", width: 130, filter: "agDateColumnFilter",
        valueFormatter: (p) => (p.value ? dateFmt.format(new Date(p.value)) : ""),
        cellClassRules: { "text-danger font-medium": (p) => Boolean(p.data && !p.data.isTotal && p.data.isOverdue) },
        filterParams: { comparator: (filterDate: Date, cell: string | null) => (cell ? cmpDay(new Date(cell), filterDate) : -1) },
      },
      { headerName: "", colId: "actions", width: 150, sortable: false, filter: false, resizable: false, cellRenderer: ActionsCell },
    ],
    [dateFmt],
  );

  const totalRow = useMemo<TotalRow[]>(
    () => [{ isTotal: true, description: `Total of ${view.rows.length} listed`, totalCents: view.totals.listedTotalCents, owedCents: view.totals.listedOwedCents }],
    [view],
  );

  const isExternalFilterPresent = useCallback(() => {
    const f = filtersRef.current;
    return f.overdueOnly || f.owedToMe || Boolean(f.childId);
  }, []);
  const doesExternalFilterPass = useCallback((node: IRowNode<GridRow | TotalRow>) => {
    const d = node.data;
    if (!d || d.isTotal) return true;
    const f = filtersRef.current;
    return (!f.overdueOnly || d.isOverdue) && (!f.owedToMe || d.owedToMe) && (!f.childId || d.childId === f.childId);
  }, []);

  function setFilter(patch: Partial<Filters>) {
    const next = { ...filtersRef.current, ...patch };
    filtersRef.current = next;
    setFilters(next);
    apiRef.current?.onFilterChanged();
  }

  function exportCsv() {
    apiRef.current?.exportDataAsCsv({
      fileName: `two-homes-ledger-${new Date().toISOString().slice(0, 10)}.csv`,
      onlySelected: selected > 0,
      columnKeys: ["date", "childName", "description", "category", "clause", "verdict", "approval", "settlement", "totalCents", "owedCents", "owedByName", "dueAt"],
      processCellCallback: (p) => {
        const id = p.column.getColId();
        if (id === "totalCents" || id === "owedCents") return typeof p.value === "number" ? formatCents(p.value) : "";
        if ((id === "date" || id === "dueAt") && p.value) return String(p.value).slice(0, 10);
        return p.value ?? "";
      },
    });
  }

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-[220px] flex-1">
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="search"
          aria-label="Search the ledger"
          placeholder="Search description, vendor, child…"
          className="h-11 pl-9 text-base lg:h-10 lg:text-sm"
          value={quick}
          onChange={(e) => setQuick(e.target.value)}
          name="ledger-search"
          autoComplete="off"
        />
      </div>
      <FilterChip pressed={filters.overdueOnly} onClick={() => setFilter({ overdueOnly: !filters.overdueOnly })}>Overdue only</FilterChip>
      <FilterChip pressed={filters.owedToMe} onClick={() => setFilter({ owedToMe: !filters.owedToMe })}>Owed to me</FilterChip>
      {view.children.length > 1 ? (
        <select aria-label="Child" value={filters.childId} onChange={(e) => setFilter({ childId: e.target.value })} className="h-11 rounded-lg border border-input bg-surface px-3 text-base lg:h-10 lg:text-sm">
          <option value="">All children</option>
          {view.children.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      ) : null}
      {desktop ? (
        <Button variant="outline" className="h-10" onClick={exportCsv} disabled={view.rows.length === 0}>
          <Download aria-hidden /> {selected > 0 ? `Export ${selected} selected` : "Export CSV"}
        </Button>
      ) : null}
    </div>
  );

  return (
    <div className="space-y-4">
      {toolbar}
      {desktop ? (
        <div className="h-[calc(100dvh-280px)] min-h-[480px]">
          <AgGridReact<GridRow | TotalRow>
            theme={gridTheme}
            rowData={view.rows as GridRow[]}
            columnDefs={columnDefs}
            defaultColDef={{ sortable: true, resizable: true, filter: true, suppressHeaderMenuButton: false }}
            getRowId={(p) => (p.data.isTotal ? "total" : p.data.id)}
            quickFilterText={quick}
            isExternalFilterPresent={isExternalFilterPresent}
            doesExternalFilterPass={doesExternalFilterPass}
            pinnedBottomRowData={totalRow}
            rowSelection={{ mode: "multiRow", headerCheckbox: true, checkboxes: true, enableClickSelection: false }}
            onSelectionChanged={(e) => setSelected(e.api.getSelectedRows().length)}
            pagination
            paginationPageSize={25}
            paginationPageSizeSelector={[25, 50, 100]}
            multiSortKey="ctrl"
            enableCellTextSelection
            context={{ openSource: (c: { agreementId: string | null; page: number; quote: string }) => c.agreementId && setSource({ agreementId: c.agreementId, page: c.page, quote: c.quote.replace(/…$/, "") }), remind, busyId }}
            onGridReady={(e) => (apiRef.current = e.api)}
            overlayNoRowsTemplate="<span>No expenses match these filters.</span>"
          />
        </div>
      ) : (
        <LedgerCards rows={view.rows} quick={quick} filters={filters} dateFmt={dateFmt} />
      )}
      <SourceSheet target={source} onClose={() => setSource(null)} />
    </div>
  );
}

function FilterChip({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className="h-11 rounded-full border border-border px-4 text-sm font-medium transition-colors aria-pressed:border-primary aria-pressed:bg-primary-soft aria-pressed:text-primary lg:h-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {children}
    </button>
  );
}

/** Date filter comparison by calendar day: -1 before, 0 same day, 1 after. */
function cmpDay(cell: Date, filter: Date): number {
  const a = Date.UTC(cell.getUTCFullYear(), cell.getUTCMonth(), cell.getUTCDate());
  const b = Date.UTC(filter.getFullYear(), filter.getMonth(), filter.getDate());
  return a === b ? 0 : a < b ? -1 : 1;
}
