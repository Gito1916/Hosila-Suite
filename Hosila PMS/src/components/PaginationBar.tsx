import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationBarProps {
  page: number;
  pageSize: number;
  totalItems: number;
  onPageChange: (nextPage: number) => void;
  onPageSizeChange?: (nextSize: number) => void;
  pageSizeOptions?: number[];
  itemLabel?: string;
}

export function PaginationBar({
  page,
  pageSize,
  totalItems,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [25, 50, 100],
  itemLabel = 'rows',
}: PaginationBarProps) {
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = totalItems === 0 ? 0 : (safePage - 1) * pageSize + 1;
  const end = Math.min(totalItems, safePage * pageSize);

  return (
    <div className="no-print flex flex-wrap items-center justify-between gap-3 border-t border-ink/8 bg-ink/[0.015] px-4 py-2.5 text-xs text-ink/60">
      <div className="font-mono tabular-nums">
        {totalItems === 0
          ? `0 ${itemLabel}`
          : `Showing ${start}–${end} of ${totalItems} ${itemLabel}`}
      </div>

      <div className="flex items-center gap-3">
        {onPageSizeChange && (
          <label className="flex items-center gap-1.5 text-ink/55">
            <span>Rows:</span>
            <select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="rounded-lg border border-ink/12 bg-surface px-2 py-1 font-mono text-xs text-ink"
            >
              {pageSizeOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            disabled={safePage <= 1}
            onClick={() => onPageChange(safePage - 1)}
            aria-label="Previous page"
            className="inline-flex h-7 items-center gap-1 rounded-lg border border-ink/12 bg-surface px-2.5 font-medium text-ink/75 hover:bg-ink/[0.05] disabled:opacity-35 transition-colors"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
            Prev
          </button>
          <span className="px-1.5 font-mono tabular-nums text-ink/70">
            {safePage} / {totalPages}
          </span>
          <button
            type="button"
            disabled={safePage >= totalPages}
            onClick={() => onPageChange(safePage + 1)}
            aria-label="Next page"
            className="inline-flex h-7 items-center gap-1 rounded-lg border border-ink/12 bg-surface px-2.5 font-medium text-ink/75 hover:bg-ink/[0.05] disabled:opacity-35 transition-colors"
          >
            Next
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
