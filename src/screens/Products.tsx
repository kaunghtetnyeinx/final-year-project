import { useState } from "react"
import Heading from "../components/Heading"
import Icon from "../components/Icon"
import Table from "../components/Table"
import { api } from "../lib/api"
import { money, myDate } from "../lib/format"
import { image, productPhotos } from "../lib/images"
import { INGREDIENTS, Product, isIngredient } from "../lib/types"

export default function Products({
  products,
  categories,
  isAdmin,
  onSaved,
}: {
  products: Product[]
  categories: string[]
  isAdmin: boolean
  onSaved: (product: Product) => void
}) {
  const [search, setSearch] = useState("")
  const query = search.trim().toLowerCase()
  const shown = products.filter((p) =>
    `${p.name} ${p.sku} ${p.category}`.toLowerCase().includes(query),
  )
  const rows = shown.map((p) => [
    p.sku,
    p.name,
    p.category,
    isIngredient(p) ? "—" : money(p.price),
    p.isActive ? "Active" : "Inactive",
    myDate(new Date(p.updated)),
  ])
  // null = closed, "new" = add form, a product = edit form
  const [editing, setEditing] = useState<Product | "new" | null>(null)
  return (
    <div className="p-8">
      <Heading
        title="Products"
        subtitle="Current retail catalogue and selling prices. Historical prices remain on transaction lines."
      />
      <div className="mt-6 flex justify-between">
        <label className="flex w-80 items-center gap-2 rounded border border-[#D9DAD5] bg-white px-3 py-2.5">
          <Icon name="search" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-full bg-transparent text-xs outline-none"
            placeholder="Search products or SKU"
          />
        </label>
        {isAdmin && (
          <button
            className="rounded bg-[#24302C] px-4 text-xs font-bold text-white"
            onClick={() => setEditing("new")}
          >
            + Add product
          </button>
        )}
      </div>
      <Table
        headers={[
          "SKU",
          "Product",
          "Category",
          "Selling price",
          "Status",
          "Updated",
        ]}
        rows={rows}
        empty="No products match this search."
        action={
          isAdmin
            ? (index) => (
                <button
                  onClick={() => setEditing(shown[index])}
                  className="rounded border border-[#D9DAD5] bg-white px-2.5 py-1.5 text-[11px] font-bold text-[#28695E] hover:border-[#28695E]"
                >
                  Edit
                </button>
              )
            : undefined
        }
      />
      {editing && (
        <ProductModal
          product={editing === "new" ? null : editing}
          categories={categories}
          onClose={() => setEditing(null)}
          onSaved={(product) => {
            onSaved(product)
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

export const CUSTOM_PHOTO = "custom"

/** Add a product (product = null) or edit one. Stock is not edited here: use purchases or adjustments. */
export function ProductModal({
  product,
  categories,
  onClose,
  onSaved,
}: {
  product: Product | null
  categories: string[]
  onClose: () => void
  onSaved: (product: Product) => void
}) {
  const isNew = product === null
  const startPhoto = product?.image ?? image.coffee
  const preset = productPhotos.find(([, url]) => url === startPhoto)?.[0]
  const [name, setName] = useState(product?.name ?? "")
  const [sku, setSku] = useState(product?.sku ?? "")
  const [category, setCategory] = useState(product?.category ?? categories[0] ?? "")
  const [price, setPrice] = useState(product?.price ?? 0)
  const [stock, setStock] = useState(0)
  const [reorder, setReorder] = useState(product?.reorder ?? 0)
  const [photo, setPhoto] = useState(preset ?? CUSTOM_PHOTO)
  const [customUrl, setCustomUrl] = useState(preset ? "" : startPhoto)
  const [isActive, setIsActive] = useState(product?.isActive ?? true)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const save = async () => {
    const cleanSku = sku.trim().toUpperCase()
    if (!name.trim() || !cleanSku) return setError("Name and SKU are required.")
    if (price <= 0 && category !== INGREDIENTS)
      return setError("Selling price must be greater than 0.")
    const imageUrl =
      photo === CUSTOM_PHOTO ? customUrl.trim() || null : (image[photo as keyof typeof image] ?? null)
    if (imageUrl && !/^https?:\/\/\S+$/.test(imageUrl))
      return setError("Image must be a web address starting with http:// or https://")
    setBusy(true)
    setError("")
    try {
      const { product: saved } = isNew
        ? await api<{ product: Product }>("/products", {
            method: "POST",
            body: { name: name.trim(), sku: cleanSku, category, price, stock, reorder, image: imageUrl },
          })
        : await api<{ product: Product }>(`/products/${product.id}`, {
            method: "PATCH",
            body: { name: name.trim(), price, reorder, image: imageUrl, isActive },
          })
      onSaved(saved)
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }
  const field = "mt-2 w-full border border-[#D9DAD5] bg-white px-4 py-3 text-sm outline-none disabled:bg-[#F3F3F1] disabled:text-[#8B8F89]"
  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-[#1F2925]/45 p-6">
      <div className="w-full max-w-sm rounded-md bg-white p-7 text-center shadow-xl">
        <h2 className="mt-4 font-display text-xl font-bold">
          {isNew ? "Add product" : `Edit ${product.name}`}
        </h2>
        {error && (
          <p className="mt-3 rounded bg-[#F5E7E3] px-3 py-2 text-left text-xs text-[#A34E42]">
            {error}
          </p>
        )}
        <label className="mt-5 block text-left text-xs font-bold">
          Name
          <input value={name} onChange={(event) => setName(event.target.value)} className={field} />
        </label>
        <label className="mt-3 block text-left text-xs font-bold">
          SKU
          <input
            value={sku}
            disabled={!isNew}
            onChange={(event) => setSku(event.target.value)}
            className={field}
          />
        </label>
        <label className="mt-3 block text-left text-xs font-bold">
          Category
          <select
            value={category}
            disabled={!isNew}
            onChange={(event) => setCategory(event.target.value)}
            className={field}
          >
            {categories.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className="mt-3 block text-left text-xs font-bold">
          Selling price (MYR)
          <input
            type="number"
            min={0}
            step="0.01"
            value={price}
            onChange={(event) => setPrice(Math.max(0, Number(event.target.value) || 0))}
            className={field}
          />
        </label>
        {isNew && (
          <label className="mt-3 block text-left text-xs font-bold">
            Opening stock
            <input
              type="number"
              min={0}
              step={1}
              value={stock}
              onChange={(event) =>
                setStock(Math.max(0, Math.floor(Number(event.target.value)) || 0))
              }
              className={field}
            />
          </label>
        )}
        <label className="mt-3 block text-left text-xs font-bold">
          Reorder level
          <input
            type="number"
            min={0}
            step={1}
            value={reorder}
            onChange={(event) =>
              setReorder(Math.max(0, Math.floor(Number(event.target.value)) || 0))
            }
            className={field}
          />
        </label>
        <label className="mt-3 block text-left text-xs font-bold">
          Image
          <select value={photo} onChange={(event) => setPhoto(event.target.value)} className={field}>
            {productPhotos.map(([key]) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
            <option value={CUSTOM_PHOTO}>Custom image URL…</option>
          </select>
        </label>
        {photo === CUSTOM_PHOTO && (
          <input
            value={customUrl}
            onChange={(event) => setCustomUrl(event.target.value)}
            placeholder="https://…"
            aria-label="Image URL"
            className={field}
          />
        )}
        {!isNew && (
          <label className="mt-4 flex items-center gap-2 text-left text-xs font-bold">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(event) => setIsActive(event.target.checked)}
            />
            Active (shown on the sale screen)
          </label>
        )}
        {!isNew && (
          <p className="mt-3 text-left text-[11px] text-[#858983]">
            Stock changes through purchases and inventory adjustments, so every change is audited.
          </p>
        )}
        <button
          onClick={save}
          disabled={busy}
          className="mt-5 w-full rounded bg-[#28695E] py-3 text-sm font-bold text-white disabled:opacity-60"
        >
          {busy ? "Saving…" : isNew ? "Add product" : "Save changes"}
        </button>
        <button
          onClick={onClose}
          className="mt-3 w-full rounded border border-[#D9DAD5] bg-white py-3 text-sm font-bold text-[#666A65]"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
