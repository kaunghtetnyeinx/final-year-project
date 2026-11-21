import Heading from "../components/Heading"
import Table from "../components/Table"
import { myStamp } from "../lib/format"
import { Movement } from "../lib/types"

export default function StockMovements({ movements }: { movements: Movement[] }) {
  const rows = movements.map((m) => [
    m.id,
    m.product,
    m.type,
    m.change > 0 ? `+${m.change}` : `−${Math.abs(m.change)}`,
    m.source,
    m.by,
    myStamp(m.created),
  ])
  return (
    <div className="p-8">
      <Heading
        title="Stock movements"
        subtitle="Append-only inventory history. Every posted transaction line creates at most one movement."
      />
      <div className="mt-5 rounded border-l-2 border-[#28695E] bg-[#EAF1EF] p-4 text-xs text-[#5E6863]">
        <strong>Audit rule:</strong> Movement records are not edited or deleted.
        Corrections are posted as new adjustments with a reason.
      </div>
      <Table
        headers={[
          "Movement",
          "Product",
          "Type",
          "Change",
          "Source",
          "Recorded by",
          "Created",
        ]}
        rows={rows}
        empty="No stock movements yet."
      />
    </div>
  )
}
