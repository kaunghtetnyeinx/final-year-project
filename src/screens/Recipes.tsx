import { useEffect, useState, type Dispatch, type SetStateAction } from "react"
import Heading from "../components/Heading"
import Icon from "../components/Icon"
import { api } from "../lib/api"
import { money, myStamp, pct, qty, round4, unitMoney } from "../lib/format"
import { baseUnitOf } from "../lib/recipes"
import { Product, RecipeLine, Wire, isIngredient, toRecipe } from "../lib/types"

// ---------------------------------------------------------------------------
// Recipes & margins
// ---------------------------------------------------------------------------

/** Latest posted purchase unit cost per SKU. The server keeps it in products.cost_price. */
export const latestPurchaseCosts = (catalogue: Product[]) =>
  new Map(catalogue.filter((p) => p.costPrice > 0).map((p) => [p.sku, p.costPrice]))

/** True if `fromId`'s recipe (directly or through sub-recipes) uses `targetId`. */
export const recipeReaches = (
  fromId: number,
  targetId: number,
  recipes: RecipeLine[],
  seen = new Set<number>(),
): boolean => {
  if (fromId === targetId) return true
  if (seen.has(fromId)) return false
  seen.add(fromId)
  return recipes
    .filter((r) => r.productId === fromId)
    .some((r) => recipeReaches(r.ingredientId, targetId, recipes, seen))
}

export type CostedLine = RecipeLine & {
  ingredient: Product | undefined
  unitCost: number | null
  lineCost: number | null
  source: "purchase" | "recipe" | "missing"
}

export type RecipeCosting = { lines: CostedLine[]; cost: number; missing: string[] }

/**
 * Cost of ONE unit of a product from its recipe. An ingredient's unit cost is its
 * latest purchase cost, or, if the ingredient has its own recipe, that sub-recipe's cost.
 */
export function costRecipe(
  productId: number,
  recipes: RecipeLine[],
  catalogue: Product[],
  costs: Map<string, number>,
  trail: number[] = [],
): RecipeCosting {
  const path = [...trail, productId]
  const lines: CostedLine[] = recipes
    .filter((r) => r.productId === productId)
    .map((r) => {
      const ingredient = catalogue.find((p) => p.id === r.ingredientId)
      let unitCost: number | null = null
      let source: CostedLine["source"] = "missing"
      if (ingredient && !path.includes(ingredient.id)) {
        if (recipes.some((x) => x.productId === ingredient.id)) {
          const sub = costRecipe(ingredient.id, recipes, catalogue, costs, path)
          if (sub.missing.length === 0) {
            unitCost = sub.cost
            source = "recipe"
          }
        } else if (costs.has(ingredient.sku)) {
          unitCost = costs.get(ingredient.sku)!
          source = "purchase"
        }
      }
      return {
        ...r,
        ingredient,
        unitCost,
        source,
        lineCost: unitCost === null ? null : unitCost * r.quantityRequired,
      }
    })
  return {
    lines,
    cost: lines.reduce((sum, line) => sum + (line.lineCost ?? 0), 0),
    missing: lines
      .filter((line) => line.unitCost === null)
      .map((line) => line.ingredient?.name ?? `Product #${line.ingredientId}`),
  }
}

export type MarginStatus = "met" | "below" | "incomplete" | "none"

export const statusBadge: Record<MarginStatus, [string, string]> = {
  met: ["Target maintained", "bg-[#E4F0E7] text-[#357049]"],
  below: ["Below target", "bg-[#F5E7E3] text-[#A34E42]"],
  incomplete: ["Cost missing", "bg-[#F4EEDC] text-[#8A7A4A]"],
  none: ["No recipe", "bg-[#EEEDEA] text-[#777C76]"],
}

/** Horizontal margin bar with a marker at the target. */
export function MarginBar({ margin, target }: { margin: number | null; target: number }) {
  const width = Math.max(0, Math.min(1, margin ?? 0)) * 100
  const met = margin !== null && margin >= target - 1e-9
  return (
    <div className="relative h-1.5 w-full rounded-full bg-[#ECEDE9]">
      <div
        className={`h-full rounded-full ${met ? "bg-[#4F8A62]" : "bg-[#C46A5C]"}`}
        style={{ width: `${width}%` }}
      />
      <div
        className="absolute -top-1 h-3.5 w-0.5 bg-[#24302C]"
        style={{ left: `${target * 100}%` }}
        title={`Target ${pct(target)}`}
      />
    </div>
  )
}

export type Suggestion = {
  kind: "Price" | "Supplier" | "Recipe"
  title: string
  detail: string
  applyLabel?: string
  apply?: () => void
}

export default function Recipes({
  catalogue,
  recipes,
  setRecipes,
  target,
  onTargetChange,
  onApplyPrice,
}: {
  catalogue: Product[]
  recipes: RecipeLine[]
  setRecipes: Dispatch<SetStateAction<RecipeLine[]>>
  target: number
  onTargetChange: (target: number) => Promise<void>
  onApplyPrice: (productId: number, price: number) => Promise<void>
}) {
  const costs = latestPurchaseCosts(catalogue)
  // The input is edited freely; the target is saved only when it is a valid whole percent.
  const [targetText, setTargetText] = useState(String(Math.round(target * 100)))
  const [targetError, setTargetError] = useState("")
  useEffect(() => setTargetText(String(Math.round(target * 100))), [target])
  const saveTarget = async () => {
    const value = Math.round(Number(targetText))
    if (!(value >= 1 && value <= 95)) {
      setTargetError("Enter a whole number from 1 to 95.")
      return setTargetText(String(Math.round(target * 100)))
    }
    setTargetError("")
    if (value / 100 === target) return
    try {
      await onTargetChange(value / 100)
    } catch (err) {
      setTargetError((err as Error).message)
    }
  }
  const rows = catalogue
    .filter((p) => !isIngredient(p) || recipes.some((r) => r.productId === p.id))
    .map((product) => {
      const costing = costRecipe(product.id, recipes, catalogue, costs)
      const hasRecipe = costing.lines.length > 0
      const complete = hasRecipe && costing.missing.length === 0
      const margin =
        complete && product.price > 0 ? (product.price - costing.cost) / product.price : null
      const status: MarginStatus = !hasRecipe
        ? "none"
        : !complete || margin === null
          ? "incomplete"
          : margin >= target - 1e-9
            ? "met"
            : "below"
      return { product, costing, margin, status }
    })
  const [selectedId, setSelectedId] = useState(
    () => rows.find((r) => r.status === "below")?.product.id ?? rows[0]?.product.id ?? 0,
  )
  const selected = rows.find((r) => r.product.id === selectedId) ?? rows[0]
  const evaluated = rows.filter((r) => r.margin !== null)
  const average = evaluated.length
    ? evaluated.reduce((sum, r) => sum + (r.margin ?? 0), 0) / evaluated.length
    : null
  const columns = "minmax(0,2fr) repeat(3, minmax(0,1fr)) minmax(0,1.5fr) minmax(0,1.2fr)"

  return (
    <div className="p-8">
      <Heading
        title="Recipes & margins"
        subtitle="Ingredient cost per unit from each recipe, checked against the target profit margin."
      />
      <div className="mt-6 grid grid-cols-[260px_1fr_1fr_1fr] gap-4">
        <label className="rounded border border-[#28695E] bg-[#EAF1EF] p-5 text-xs font-bold text-[#28695E]">
          Target profit margin
          <div className="mt-2 flex items-baseline gap-1">
            <input
              type="number"
              min={1}
              max={95}
              step={1}
              value={targetText}
              onChange={(event) => setTargetText(event.target.value)}
              onBlur={saveTarget}
              onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
              aria-label="Target profit margin percent"
              className="w-20 border border-[#B9CEC8] bg-white px-2 py-1 font-display text-2xl font-bold text-[#24302C] outline-none"
            />
            <span className="font-display text-2xl text-[#24302C]">%</span>
          </div>
          {targetError && (
            <span className="mt-1 block text-[10px] font-normal text-[#A34E42]">{targetError}</span>
          )}
        </label>
        {[
          [`${rows.filter((r) => r.status === "met").length} / ${evaluated.length}`, "Products meeting target"],
          [String(rows.filter((r) => r.status === "below").length), "Below target"],
          [average === null ? "—" : pct(average), "Average margin"],
        ].map(([value, label]) => (
          <div key={label} className="rounded border border-[#DEDFDA] bg-white p-5">
            <p className="font-display text-2xl font-bold">{value}</p>
            <p className="mt-1 text-xs text-[#7E827C]">{label}</p>
          </div>
        ))}
      </div>
      <p className="mt-4 text-[11px] leading-relaxed text-[#7E827C]">
        Margin = (selling price − ingredient cost) ÷ selling price. Selling prices exclude
        service charge and SST. Ingredient costs use each ingredient's latest posted purchase.
        Labour, rent and utilities are not in the data model, so this is the ingredient-cost
        margin. Recipes do not deduct ingredient stock when a sale is posted.
      </p>

      <div className="mt-5 overflow-hidden rounded border border-[#DEDFDA] bg-white">
        <div
          className="grid bg-[#EEEDEA] px-5 py-3 text-[10px] font-bold uppercase tracking-[.1em] text-[#777C76]"
          style={{ gridTemplateColumns: columns }}
        >
          {["Product", "Selling price", "Recipe cost", "Profit / unit", "Margin", "Status"].map((h) => (
            <span key={h}>{h}</span>
          ))}
        </div>
        {rows.map(({ product, costing, margin, status }) => {
          const [label, badge] = statusBadge[status]
          const active = selected?.product.id === product.id
          return (
            <button
              key={product.id}
              onClick={() => setSelectedId(product.id)}
              aria-pressed={active}
              className={`grid w-full items-center border-t border-[#E8E9E4] px-5 py-3.5 text-left text-xs ${
                active ? "bg-[#F3F7F5] shadow-[inset_3px_0_0_#28695E]" : "hover:bg-[#F7F7F5]"
              }`}
              style={{ gridTemplateColumns: columns }}
            >
              <span className="truncate pr-3">
                <span className="font-bold">{product.name}</span>
                <span className="ml-2 text-[#92948E]">{product.sku}</span>
              </span>
              <span>{isIngredient(product) ? "—" : money(product.price)}</span>
              <span>{costing.lines.length ? unitMoney(round4(costing.cost)) : "—"}</span>
              <span>{margin === null ? "—" : money(product.price - costing.cost)}</span>
              <span className="flex items-center gap-3 pr-4">
                <span className="w-12 font-bold">{margin === null ? "—" : pct(margin)}</span>
                {margin !== null && <MarginBar margin={margin} target={target} />}
              </span>
              <span>
                <span className={`rounded-full px-2 py-1 text-[10px] font-bold ${badge}`}>
                  {label}
                </span>
              </span>
            </button>
          )
        })}
      </div>

      {selected && (
        <RecipeDetail
          key={selected.product.id}
          product={selected.product}
          costing={selected.costing}
          margin={selected.margin}
          status={selected.status}
          target={target}
          catalogue={catalogue}
          recipes={recipes}
          setRecipes={setRecipes}
          onApplyPrice={onApplyPrice}
        />
      )}
    </div>
  )
}

export function RecipeDetail({
  product,
  costing,
  margin,
  status,
  target,
  catalogue,
  recipes,
  setRecipes,
  onApplyPrice,
}: {
  product: Product
  costing: RecipeCosting
  margin: number | null
  status: MarginStatus
  target: number
  catalogue: Product[]
  recipes: RecipeLine[]
  setRecipes: Dispatch<SetStateAction<RecipeLine[]>>
  onApplyPrice: (productId: number, price: number) => Promise<void>
}) {
  const price = product.price
  const cost = costing.cost
  const [label, badge] = statusBadge[status]

  // ---- Recipe line form (add / edit) ----
  const [editingId, setEditingId] = useState<number | null>(null)
  const [ingredientId, setIngredientId] = useState(0)
  const [quantity, setQuantity] = useState("")
  const [unit, setUnit] = useState("")
  const [notes, setNotes] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const options = catalogue.filter((p) => p.id !== product.id && p.isActive)
  /** Runs one API change, showing any server error in the form. */
  const run = async (action: () => Promise<void>) => {
    setBusy(true)
    setError("")
    try {
      await action()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const replaceLine = (line: RecipeLine) =>
    setRecipes((current) => current.map((r) => (r.recipeId === line.recipeId ? line : r)))
  const resetForm = () => {
    setEditingId(null)
    setIngredientId(0)
    setQuantity("")
    setUnit("")
    setNotes("")
    setError("")
  }
  const startEdit = (line: RecipeLine) => {
    setEditingId(line.recipeId)
    setIngredientId(line.ingredientId)
    setQuantity(qty(line.quantityRequired))
    setUnit(line.unit)
    setNotes(line.notes ?? "")
    setError("")
  }
  const chooseIngredient = (id: number) => {
    setIngredientId(id)
    const known = baseUnitOf(id, recipes)
    if (known) setUnit(known)
  }
  const save = () => {
    const amount = Number(quantity)
    const cleanUnit = unit.trim()
    if (!ingredientId) return setError("Choose an ingredient.")
    // Application rules from the ERD
    if (ingredientId === product.id) return setError("A product cannot be an ingredient of itself.")
    if (recipeReaches(ingredientId, product.id, recipes))
      return setError("This would create a circular recipe.")
    if (!Number.isFinite(amount) || amount <= 0)
      return setError("Quantity required must be greater than 0.")
    if (Math.abs(amount * 1000 - Math.round(amount * 1000)) > 1e-6)
      return setError("Quantity can have at most 3 decimal places.")
    if (!cleanUnit) return setError("Unit is required.")
    if (cleanUnit.length > 20) return setError("Unit can be at most 20 characters.")
    const known = baseUnitOf(ingredientId, recipes, editingId ?? undefined)
    if (known && known !== cleanUnit)
      return setError(`Use the same base unit as other recipes for this ingredient: "${known}".`)
    const duplicate = recipes.some(
      (r) => r.productId === product.id && r.ingredientId === ingredientId && r.recipeId !== editingId,
    )
    if (duplicate) return setError("This ingredient is already in the recipe. Edit that line instead.")
    const fields = { quantityRequired: amount, unit: cleanUnit, notes: notes.trim() || null }
    run(async () => {
      if (editingId !== null) {
        const { recipe } = await api<{ recipe: Wire<RecipeLine, "createdAt" | "updatedAt"> }>(
          `/recipes/${editingId}`,
          { method: "PATCH", body: fields },
        )
        replaceLine(toRecipe(recipe))
      } else {
        const { recipe } = await api<{ recipe: Wire<RecipeLine, "createdAt" | "updatedAt"> }>("/recipes", {
          method: "POST",
          body: { productId: product.id, ingredientId, ...fields },
        })
        setRecipes((current) => [...current, toRecipe(recipe)])
      }
      resetForm()
    })
  }
  const remove = (recipeId: number) =>
    run(async () => {
      await api(`/recipes/${recipeId}`, { method: "DELETE" })
      setRecipes((current) => current.filter((r) => r.recipeId !== recipeId))
      if (editingId === recipeId) resetForm()
    })
  const setLineQuantity = (recipeId: number, amount: number) =>
    run(async () => {
      const { recipe } = await api<{ recipe: Wire<RecipeLine, "createdAt" | "updatedAt"> }>(
        `/recipes/${recipeId}`,
        { method: "PATCH", body: { quantityRequired: amount } },
      )
      replaceLine(toRecipe(recipe))
    })

  // ---- Suggestions when the target margin is not met ----
  const suggestions: Suggestion[] = []
  const maxCost = price * (1 - target)
  const gap = cost - maxCost // > 0: how much cost must fall to reach the target
  if (status === "below") {
    const newPrice = Math.ceil((cost / (1 - target)) * 10 - 1e-9) / 10
    suggestions.push({
      kind: "Price",
      title: `Increase the price to ${money(newPrice)}`,
      detail: `From ${money(price)} (+${pct((newPrice - price) / price)}). At ${money(newPrice)} the margin is ${pct((newPrice - cost) / newPrice)}.`,
      applyLabel: `Set price to ${money(newPrice)}`,
      apply: () => run(() => onApplyPrice(product.id, newPrice)),
    })

    const purchased = costing.lines
      .filter((l) => l.source === "purchase" && (l.lineCost ?? 0) > 0)
      .sort((a, b) => (b.lineCost ?? 0) - (a.lineCost ?? 0))
    const biggest = purchased[0]
    if (biggest && (biggest.lineCost ?? 0) > gap) {
      const lineCost = biggest.lineCost ?? 0
      const targetUnitCost = Math.floor(((lineCost - gap) / biggest.quantityRequired) * 10000) / 10000
      suggestions.push({
        kind: "Supplier",
        title: `Find a cheaper supplier for ${biggest.ingredient?.name}`,
        detail: `It is the largest cost in this recipe (${pct(lineCost / cost)}). Buying it at ${unitMoney(targetUnitCost)}/${biggest.unit} or less (now ${unitMoney(biggest.unitCost ?? 0)}/${biggest.unit}, −${pct(gap / lineCost)}) reaches the target.`,
      })
    } else if (biggest) {
      suggestions.push({
        kind: "Supplier",
        title: "A supplier change alone is not enough",
        detail: `Even ${biggest.ingredient?.name} at no cost would not close the ${money(gap)} gap. Combine a price increase with lower ingredient costs.`,
      })
    }

    // Reduce one ingredient by at most 35% (pieces such as eggs or bottles are not reduced).
    const reductions = costing.lines
      .filter((l) => l.unitCost && l.lineCost && l.lineCost > gap && l.unit.toLowerCase() !== "piece")
      .map((l) => {
        const newQty = Math.floor((((l.lineCost ?? 0) - gap) / (l.unitCost ?? 1)) * 10) / 10
        return { line: l, newQty, cut: 1 - newQty / l.quantityRequired }
      })
      .filter((r) => r.newQty > 0 && r.cut <= 0.35)
      .sort((a, b) => a.cut - b.cut)
    const best = reductions[0]
    if (best) {
      suggestions.push({
        kind: "Recipe",
        title: `Use less ${best.line.ingredient?.name}`,
        detail: `Reduce it from ${qty(best.line.quantityRequired)} ${best.line.unit} to ${qty(best.newQty)} ${best.line.unit} per unit (−${pct(best.cut)}), saving ${unitMoney(round4((best.line.quantityRequired - best.newQty) * (best.line.unitCost ?? 0)))} per unit. Check that taste and portion size stay acceptable.`,
        applyLabel: `Set to ${qty(best.newQty)} ${best.line.unit}`,
        apply: () => setLineQuantity(best.line.recipeId, best.newQty),
      })
    } else {
      suggestions.push({
        kind: "Recipe",
        title: "No single ingredient can be reduced enough",
        detail: "Cutting any one ingredient by up to 35% would not reach the target. Use a price increase or a cheaper supplier instead.",
      })
    }
  }

  return (
    <section className="mt-6 rounded border border-[#DEDFDA] bg-white">
      <header className="flex items-start justify-between gap-6 border-b border-[#E4E5E0] p-6">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[.12em] text-[#858983]">
            Recipe · {product.sku}
          </p>
          <h2 className="mt-1 font-display text-2xl font-bold">{product.name}</h2>
          <span className={`mt-2 inline-block rounded-full px-2 py-1 text-[10px] font-bold ${badge}`}>
            {label}
          </span>
        </div>
        <dl className="grid grid-cols-4 gap-6 text-right">
          {[
            ["Selling price", isIngredient(product) ? "—" : money(price)],
            ["Recipe cost", costing.lines.length ? unitMoney(round4(cost)) : "—"],
            ["Profit / unit", margin === null ? "—" : money(price - cost)],
            ["Margin", margin === null ? "—" : pct(margin)],
          ].map(([term, value]) => (
            <div key={term}>
              <dt className="text-[10px] font-bold uppercase tracking-[.1em] text-[#858983]">{term}</dt>
              <dd className="mt-1 font-display text-xl font-bold">{value}</dd>
            </div>
          ))}
        </dl>
      </header>

      {margin !== null && (
        <div className="border-b border-[#E4E5E0] px-6 py-4">
          <div className="mb-2 flex justify-between text-[11px] text-[#7E827C]">
            <span>Margin {pct(margin)}</span>
            <span>Target {pct(target)} · max ingredient cost {money(maxCost)}</span>
          </div>
          <MarginBar margin={margin} target={target} />
        </div>
      )}

      {/* Recipe lines */}
      <div className="p-6">
        <h3 className="text-xs font-bold">Ingredients per 1 unit</h3>
        {costing.missing.length > 0 && (
          <p className="mt-3 rounded bg-[#F4EEDC] px-3 py-2 text-xs text-[#7A6A3A]">
            No purchase cost yet for {costing.missing.join(", ")}. Record a purchase in
            Transactions to calculate the margin.
          </p>
        )}
        <div className="mt-3 overflow-hidden rounded border border-[#E4E5E0]">
          <div className="grid grid-cols-[minmax(0,2fr)_90px_110px_100px_70px_minmax(0,1.6fr)_100px_120px] bg-[#F3F3F1] px-4 py-2.5 text-[10px] font-bold uppercase tracking-[.1em] text-[#777C76]">
            {["Ingredient", "Quantity", "Unit cost", "Line cost", "Share", "Notes", "Updated", ""].map((h, i) => (
              <span key={i}>{h}</span>
            ))}
          </div>
          {costing.lines.length === 0 && (
            <p className="border-t border-[#E8E9E4] px-4 py-6 text-center text-xs text-[#8B8F89]">
              No recipe yet. Add the ingredients needed to make one {product.name}.
            </p>
          )}
          {[...costing.lines]
            .sort((a, b) => (b.lineCost ?? -1) - (a.lineCost ?? -1))
            .map((line) => (
              <div
                key={line.recipeId}
                className={`grid grid-cols-[minmax(0,2fr)_90px_110px_100px_70px_minmax(0,1.6fr)_100px_120px] items-center border-t border-[#E8E9E4] px-4 py-2.5 text-xs ${
                  editingId === line.recipeId ? "bg-[#F3F7F5]" : ""
                }`}
              >
                <span className="truncate pr-2">
                  <span className="font-bold">{line.ingredient?.name ?? `#${line.ingredientId}`}</span>
                  {line.source === "recipe" && (
                    <span className="ml-1.5 text-[10px] text-[#28695E]">sub-recipe</span>
                  )}
                </span>
                <span>
                  {qty(line.quantityRequired)} {line.unit}
                </span>
                <span>{line.unitCost === null ? "—" : `${unitMoney(round4(line.unitCost))}/${line.unit}`}</span>
                <span className="font-bold">{line.lineCost === null ? "—" : unitMoney(round4(line.lineCost))}</span>
                <span>{line.lineCost === null || cost === 0 ? "—" : pct(line.lineCost / cost)}</span>
                <span className="truncate pr-2 text-[#7E827C]" title={line.notes ?? ""}>
                  {line.notes ?? "—"}
                </span>
                <span className="text-[#7E827C]">{myStamp(line.updatedAt)}</span>
                <span className="flex justify-end gap-1.5">
                  <button
                    onClick={() => startEdit(line)}
                    className="rounded border border-[#D9DAD5] px-2 py-1 text-[11px] font-bold text-[#28695E]"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => remove(line.recipeId)}
                    disabled={busy}
                    aria-label={`Remove ${line.ingredient?.name}`}
                    className="rounded border border-[#D9DAD5] px-2 py-1 text-[#A34E42]"
                  >
                    <Icon name="trash" size={12} />
                  </button>
                </span>
              </div>
            ))}
        </div>

        {/* Add / edit form */}
        <div className="mt-4 rounded border border-dashed border-[#CAD7D3] bg-[#FAFBFA] p-4">
          <p className="text-xs font-bold">
            {editingId !== null ? "Edit ingredient line" : "Add ingredient"}
          </p>
          {error && (
            <p className="mt-2 rounded bg-[#F5E7E3] px-3 py-2 text-xs text-[#A34E42]">{error}</p>
          )}
          <div className="mt-3 grid grid-cols-[minmax(0,2fr)_110px_100px_minmax(0,2fr)_auto] items-end gap-3">
            <label className="text-[11px] font-bold text-[#666A65]">
              Ingredient
              <select
                value={ingredientId}
                disabled={editingId !== null}
                onChange={(event) => chooseIngredient(Number(event.target.value))}
                className="mt-1 w-full border border-[#D9DAD5] bg-white px-3 py-2 text-xs font-normal text-[#24302C] outline-none disabled:bg-[#F3F3F1]"
              >
                <option value={0}>Select…</option>
                <optgroup label="Ingredients">
                  {options.filter(isIngredient).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {baseUnitOf(p.id, recipes) ? ` (${baseUnitOf(p.id, recipes)})` : ""}
                    </option>
                  ))}
                </optgroup>
                <optgroup label="Other products (sub-recipes)">
                  {options.filter((p) => !isIngredient(p)).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </optgroup>
              </select>
            </label>
            <label className="text-[11px] font-bold text-[#666A65]">
              Quantity
              <input
                type="number"
                min={0}
                step="any"
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
                className="mt-1 w-full border border-[#D9DAD5] bg-white px-3 py-2 text-xs font-normal text-[#24302C] outline-none"
              />
            </label>
            <label className="text-[11px] font-bold text-[#666A65]">
              Unit
              <input
                value={unit}
                maxLength={20}
                placeholder="g, ml, piece"
                onChange={(event) => setUnit(event.target.value)}
                className="mt-1 w-full border border-[#D9DAD5] bg-white px-3 py-2 text-xs font-normal text-[#24302C] outline-none"
              />
            </label>
            <label className="text-[11px] font-bold text-[#666A65]">
              Notes (optional)
              <input
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                className="mt-1 w-full border border-[#D9DAD5] bg-white px-3 py-2 text-xs font-normal text-[#24302C] outline-none"
              />
            </label>
            <div className="flex gap-2">
              {editingId !== null && (
                <button
                  onClick={resetForm}
                  className="rounded border border-[#D9DAD5] bg-white px-3 py-2 text-xs font-bold text-[#666A65]"
                >
                  Cancel
                </button>
              )}
              <button
                onClick={save}
                disabled={busy}
                className="rounded bg-[#28695E] px-4 py-2 text-xs font-bold text-white disabled:opacity-60"
              >
                {busy ? "Saving…" : editingId !== null ? "Save" : "Add"}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Margin outcome */}
      <div className="border-t border-[#E4E5E0] p-6">
        {error && status === "below" && (
          <p className="mb-4 rounded bg-[#F5E7E3] px-3 py-2 text-xs text-[#A34E42]">{error}</p>
        )}
        {status === "met" && margin !== null && (
          <div className="rounded border-l-2 border-[#4F8A62] bg-[#EEF5F0] p-4 text-xs leading-relaxed text-[#45604D]">
            <strong>Target maintained.</strong> {pct(margin)} is at or above the{" "}
            {pct(target)} target. Ingredient cost could rise by up to {money(maxCost - cost)} per
            unit, or the price could drop to {money(Math.ceil((cost / (1 - target)) * 100 - 1e-9) / 100)},
            before the margin falls below target.
          </div>
        )}
        {status === "below" && (
          <>
            <div className="rounded border-l-2 border-[#C46A5C] bg-[#FBF0ED] p-4 text-xs leading-relaxed text-[#8A4A40]">
              <strong>Target not met.</strong> Margin is {pct(margin ?? 0)}, below the {pct(target)}{" "}
              target. Ingredient cost must fall by {money(gap)} per unit (to {money(maxCost)}), or the
              price must rise. Each suggestion below would reach the target on its own, unless
              it says otherwise:
            </div>
            <div className="mt-4 grid grid-cols-3 gap-4">
              {suggestions.map((s) => (
                <article key={s.kind} className="flex flex-col rounded border border-[#DEDFDA] p-4">
                  <p className="text-[10px] font-bold uppercase tracking-[.12em] text-[#28695E]">
                    {s.kind}
                  </p>
                  <h4 className="mt-1.5 text-sm font-bold">{s.title}</h4>
                  <p className="mt-1.5 flex-1 text-xs leading-relaxed text-[#6F746E]">{s.detail}</p>
                  {s.apply && (
                    <button
                      onClick={s.apply}
                      disabled={busy}
                      className="mt-3 self-start rounded border border-[#28695E] px-3 py-1.5 text-xs font-bold text-[#28695E] hover:bg-[#EAF1EF]"
                    >
                      {s.applyLabel}
                    </button>
                  )}
                </article>
              ))}
            </div>
          </>
        )}
        {status === "incomplete" && (
          <p className="text-xs text-[#7A6A3A]">
            The margin can't be checked until every ingredient has a purchase cost.
          </p>
        )}
        {status === "none" && (
          <p className="text-xs text-[#7E827C]">Add ingredients above to calculate the margin.</p>
        )}
      </div>
    </section>
  )
}
