import { type ReactNode } from "react"

export type TableProps = {
  headers: string[]
  rows: string[][]
  empty?: string
  /** Optional trailing cell per row, e.g. a button. Receives the row index. */
  action?: (rowIndex: number) => ReactNode
  /** Width of the action column in px (default 76). */
  actionWidth?: number
}

export default function Table({ headers, rows, empty = "No records found.", action, actionWidth = 76 }: TableProps) {
  const gridTemplateColumns = `repeat(${headers.length}, minmax(0, 1fr))${action ? ` ${actionWidth}px` : ""}`
  return (
    // Scrolls sideways on narrow screens (tablets in portrait) instead of squashing columns.
    <div className="mt-5 overflow-x-auto rounded border border-[#DEDFDA] bg-white">
      <div className="min-w-[720px]">
      <div
        className="grid bg-[#EEEDEA] px-5 py-3 text-[10px] font-bold uppercase tracking-[.1em] text-[#777C76]"
        style={{ gridTemplateColumns }}
      >
        {headers.map((item) => (
          <span key={item}>{item}</span>
        ))}
        {action && <span className="sr-only">Actions</span>}
      </div>
      {rows.length === 0 && (
        <p className="border-t border-[#E8E9E4] px-5 py-6 text-center text-xs text-[#8B8F89]">
          {empty}
        </p>
      )}
      {rows.map((row, rowIndex) => (
        <div
          key={`${row[0]}-${rowIndex}`}
          className={`grid items-center border-t border-[#E8E9E4] px-5 text-xs ${action ? "py-2.5" : "py-4"}`}
          style={{ gridTemplateColumns }}
        >
          {row.map((cell, index) => (
            <span
              key={index}
              className={`truncate pr-3 ${
                index === 0
                  ? "font-bold text-[#28695E]"
                  : cell === "POSTED" || cell === "Active" || cell === "In stock"
                    ? "font-bold text-[#477252]"
                    : cell === "CANCELLED" || cell === "Low" || cell === "Out of stock"
                      ? "font-bold text-[#A34E42]"
                      : cell === "DRAFT" || cell === "Inactive"
                        ? "font-bold text-[#8A7A4A]"
                        : ""
              }`}
              title={cell}
            >
              {cell}
            </span>
          ))}
          {action && <div className="flex justify-end">{action(rowIndex)}</div>}
        </div>
      ))}
      </div>
    </div>
  )
}
