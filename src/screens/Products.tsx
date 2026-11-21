import { useState } from "react"
import Heading from "../components/Heading"
import Icon from "../components/Icon"
import Table from "../components/Table"
import { api } from "../lib/api"
import { money, myDate, qty } from "../lib/format"
import { image, photoOf, productPhotos } from "../lib/images"
import { INGREDIENTS, isIngredient, type Category, type Product } from "../lib/types"

export default function Products({
  products,
  categories,
  isAdmin,
  onSaved,
  onCategoriesChanged,
}: {
  products: Product[]
  categories: Category[]
  isAdmin: boolean
  onSaved: (product: Product) => void
  onCategoriesChanged: () => Promise<void>
}) {
  const [search, setSearch] = useState("")
  const query = search.trim().toLowerCase()
  const shown = products.filter((p) => `${p.name} ${p.sku} ${p.category}`.toLowerCase().includes(query))
  const rows = shown.map((p) => [
    p.sku,
    p.name,
    p.category,
    isIngredient(p) ? "—" : money(p.price),
    p.trackStock ? qty(p.stock) : "Made to order",
    p.isActive ? "Active" : "Inactive",
    myDate(new Date(p.updated)),
  ])
  // null = closed, "new" = add form, a product = edit form
  const [editing, setEditing] = useState<Product | "new" | null>(null)
  const [categoriesOpen, setCategoriesOpen] = useState(false)
  return (
    <div className="p-4 sm:p-8">
      <Heading
        title="Products"
        subtitle="Current retail catalogue and selling prices. Historical prices remain on transaction lines."
      />
      <div className="mt-6 flex flex-wrap justify-between gap-3">
        <label className="flex w-full items-center gap-2 rounded border border-[#D9DAD5] bg-white px-3 py-2.5 sm:w-80">
          <Icon name="search" />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            className="w-full bg-transparent text-xs outline-none"
            placeholder="Search products or SKU"
          />
        </label>
        {isAdmin && (
          <div className="flex gap-2">
            <button
              className="rounded border border-[#D9DAD5] bg-white px-4 py-2.5 text-xs font-bold text-[#24302C]"
              onClick={() => setCategoriesOpen(true)}
            >
              Categories
            </button>
            <button
              className="rounded bg-[#24302C] px-4 py-2.5 text-xs font-bold text-white"
              onClick={() => setEditing("new")}
            >
              + Add product
            </button>
          </div>
        )}
      </div>
      <Table
        headers={["SKU", "Product", "Category", "Selling price", "Stock", "Status", "Updated"]}
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
          categories={categories.map((c) => c.name)}
          onClose={() => setEditing(null)}
          onSaved={(product, close) => {
            onSaved(product)
            if (close) setEditing(null)
            else setEditing(product)
          }}
        />
      )}
      {categoriesOpen && (
        <CategoriesModal
          categories={categories}
          products={products}
          onClose={() => setCategoriesOpen(false)}
          onChanged={onCategoriesChanged}
        />
      )}
    </div>
  )
}

export const CUSTOM_PHOTO = "custom"

type OptionDraft = { id?: number; name: string; priceDelta: string }

/** Add a product (product = null) or edit one. Stock is not edited here: use purchases, production or adjustments. */
export function ProductModal({
  product,
  categories,
  onClose,
  onSaved,
}: {
  product: Product | null
  categories: string[]
  onClose: () => void
  /** close = false keeps the form open (after a photo upload). */
  onSaved: (product: Product, close: boolean) => void
}) {
  const isNew = product === null
  const startPhoto = product?.image ?? image.coffee
  const preset = productPhotos.find(([, url]) => url === startPhoto)?.[0]
  const uploaded = startPhoto.startsWith("/api/uploads/")
  const [name, setName] = useState(product?.name ?? "")
  const [sku, setSku] = useState(product?.sku ?? "")
  const [category, setCategory] = useState(product?.category ?? categories.find((c) => c !== INGREDIENTS) ?? "")
  const [price, setPrice] = useState(product?.price ?? 0)
  const [stock, setStock] = useState(0)
  const [reorder, setReorder] = useState(product?.reorder ?? 0)
  const [madeToOrder, setMadeToOrder] = useState(product ? !product.trackStock : false)
  const [photo, setPhoto] = useState(uploaded ? "uploaded" : (preset ?? CUSTOM_PHOTO))
  const [customUrl, setCustomUrl] = useState(preset || uploaded ? "" : startPhoto)
  const [isActive, setIsActive] = useState(product?.isActive ?? true)
  const [options, setOptions] = useState<OptionDraft[]>(
    (product?.options ?? []).map((o) => ({ id: o.id, name: o.name, priceDelta: String(o.priceDelta) })),
  )
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const ingredient = category === INGREDIENTS
  // Moving into/out of Ingredients is not allowed once created (stock units differ).
  const categoryChoices = isNew ? categories : categories.filter((c) => (c === INGREDIENTS) === ingredient)

  const save = async () => {
    const cleanSku = sku.trim().toUpperCase()
    if (!name.trim() || !cleanSku) return setError("Name and SKU are required.")
    if (price <= 0 && !ingredient) return setError("Selling price must be greater than 0.")
    const imageUrl =
      photo === "uploaded"
        ? product?.image ?? null
        : photo === CUSTOM_PHOTO
          ? customUrl.trim() || null
          : (image[photo as keyof typeof image] ?? null)
    if (imageUrl && photo === CUSTOM_PHOTO && !/^https:\/\/\S+$/.test(imageUrl))
      return setError("Image must be a web address starting with https://")
    const cleanOptions = options
      .filter((o) => o.name.trim())
      .map((o) => ({ ...(o.id ? { id: o.id } : {}), name: o.name.trim(), priceDelta: Number(o.priceDelta) || 0 }))
    if (cleanOptions.some((o) => o.priceDelta < 0)) return setError("An option cannot lower the price.")
    setBusy(true)
    setError("")
    try {
      let { product: saved } = isNew
        ? await api<{ product: Product }>("/products", {
            method: "POST",
            body: { name: name.trim(), sku: cleanSku, category, price, stock, reorder, trackStock: !madeToOrder, image: imageUrl },
          })
        : await api<{ product: Product }>(`/products/${product.id}`, {
            method: "PATCH",
            body: { name: name.trim(), category, price, reorder, trackStock: !madeToOrder, image: imageUrl, isActive },
          })
      const optionsChanged =
        JSON.stringify(cleanOptions.map((o) => [o.name, o.priceDelta])) !==
        JSON.stringify(saved.options.map((o) => [o.name, o.priceDelta]))
      if (!ingredient && optionsChanged)
        saved = (
          await api<{ product: Product }>(`/products/${saved.id}/options`, {
            method: "PUT",
            body: { options: cleanOptions },
          })
        ).product
      onSaved(saved, true)
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }

  const upload = async (file: File) => {
    if (!product) return
    if (file.size > 2 * 1024 * 1024) return setError("The photo must be 2 MB or smaller.")
    setBusy(true)
    setError("")
    try {
      const response = await fetch(`/api/products/${product.id}/image`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.error || "Upload failed")
      setPhoto("uploaded")
      onSaved(data.product, false)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const field = "mt-2 w-full border border-[#D9DAD5] bg-white px-4 py-3 text-sm outline-none disabled:bg-[#F3F3F1] disabled:text-[#8B8F89]"
  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-[#1F2925]/45 p-4">
      <div className="my-6 w-full max-w-md rounded-md bg-white p-7 text-center shadow-xl">
        <h2 className="mt-2 font-display text-xl font-bold">{isNew ? "Add product" : `Edit ${product.name}`}</h2>
        {error && (
          <p className="mt-3 rounded bg-[#F5E7E3] px-3 py-2 text-left text-xs text-[#A34E42]">{error}</p>
        )}
        <div className="grid grid-cols-2 gap-x-3">
          <label className="col-span-2 mt-5 block text-left text-xs font-bold">
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} className={field} />
          </label>
          <label className="mt-3 block text-left text-xs font-bold">
            SKU
            <input value={sku} disabled={!isNew} onChange={(event) => setSku(event.target.value)} className={field} />
          </label>
          <label className="mt-3 block text-left text-xs font-bold">
            Category
            <select
              value={category}
              onChange={(event) => {
                setCategory(event.target.value)
                if (event.target.value === INGREDIENTS) setMadeToOrder(false)
              }}
              className={field}
            >
              {categoryChoices.map((item) => (
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
          {!madeToOrder && (
            <label className="mt-3 block text-left text-xs font-bold">
              Reorder level
              <input
                type="number"
                min={0}
                step={1}
                value={reorder}
                onChange={(event) => setReorder(Math.max(0, Math.floor(Number(event.target.value)) || 0))}
                className={field}
              />
            </label>
          )}
          {isNew && !madeToOrder && (
            <label className="mt-3 block text-left text-xs font-bold">
              Opening stock
              <input
                type="number"
                min={0}
                step={1}
                value={stock}
                onChange={(event) => setStock(Math.max(0, Math.floor(Number(event.target.value)) || 0))}
                className={field}
              />
            </label>
          )}
        </div>
        {!ingredient && (
          <label className="mt-4 flex items-start gap-2 text-left text-xs">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={madeToOrder}
              onChange={(event) => setMadeToOrder(event.target.checked)}
            />
            <span>
              <strong>Made to order</strong> (e.g. a latte): always available, no stock count. Selling it
              uses up the ingredients in its recipe.
            </span>
          </label>
        )}

        {!ingredient && (
          <div className="mt-5 text-left">
            <p className="text-xs font-bold">Options</p>
            <p className="mt-0.5 text-[11px] text-[#858983]">e.g. Large +2.00, Oat milk +1.50, Less sugar 0</p>
            {options.map((option, index) => (
              <div key={option.id ?? `new-${index}`} className="mt-2 grid grid-cols-[1fr_90px_32px] gap-2">
                <input
                  value={option.name}
                  maxLength={60}
                  placeholder="Option name"
                  aria-label="Option name"
                  onChange={(event) =>
                    setOptions((list) => list.map((o, i) => (i === index ? { ...o, name: event.target.value } : o)))
                  }
                  className="border border-[#D9DAD5] px-3 py-2 text-xs outline-none"
                />
                <input
                  type="number"
                  min={0}
                  step="0.10"
                  value={option.priceDelta}
                  aria-label="Extra price"
                  placeholder="+RM"
                  onChange={(event) =>
                    setOptions((list) => list.map((o, i) => (i === index ? { ...o, priceDelta: event.target.value } : o)))
                  }
                  className="border border-[#D9DAD5] px-3 py-2 text-xs outline-none"
                />
                <button
                  onClick={() => setOptions((list) => list.filter((_, i) => i !== index))}
                  aria-label={`Remove ${option.name || "option"}`}
                  className="grid place-items-center border border-[#D9DAD5] text-[#A34E42]"
                >
                  <Icon name="trash" size={12} />
                </button>
              </div>
            ))}
            <button
              onClick={() => setOptions((list) => [...list, { name: "", priceDelta: "0" }])}
              disabled={options.length >= 20}
              className="mt-2 text-[11px] font-bold text-[#28695E]"
            >
              + Add option
            </button>
          </div>
        )}

        <label className="mt-5 block text-left text-xs font-bold">
          Photo
          <select value={photo} onChange={(event) => setPhoto(event.target.value)} className={field}>
            {product?.image?.startsWith("/api/uploads/") && <option value="uploaded">Uploaded photo</option>}
            {productPhotos.map(([key]) => (
              <option key={key} value={key}>
                Stock photo: {key}
              </option>
            ))}
            <option value={CUSTOM_PHOTO}>Web address…</option>
          </select>
        </label>
        {photo === CUSTOM_PHOTO && (
          <input
            value={customUrl}
            onChange={(event) => setCustomUrl(event.target.value)}
            placeholder="https://…"
            aria-label="Image web address"
            className={field}
          />
        )}
        <div className="mt-3 flex items-center gap-3 text-left">
          {product && (
            <img src={photoOf(product)} alt="" className="h-14 w-20 shrink-0 rounded object-cover" />
          )}
          {isNew ? (
            <p className="text-[11px] text-[#858983]">You can upload your own photo after adding the product.</p>
          ) : (
            <label className="cursor-pointer rounded border border-[#28695E] px-3 py-2 text-[11px] font-bold text-[#28695E]">
              Upload photo (PNG, JPEG, WebP · 2 MB)
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                disabled={busy}
                onChange={(event) => event.target.files?.[0] && upload(event.target.files[0])}
              />
            </label>
          )}
        </div>

        {!isNew && (
          <label className="mt-4 flex items-center gap-2 text-left text-xs font-bold">
            <input type="checkbox" checked={isActive} onChange={(event) => setIsActive(event.target.checked)} />
            Active (shown on the sale screen)
          </label>
        )}
        {!isNew && (
          <p className="mt-3 text-left text-[11px] text-[#858983]">
            Stock changes through purchases, production and inventory adjustments, so every change is audited.
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
          {isNew ? "Cancel" : "Close"}
        </button>
      </div>
    </div>
  )
}

/** Add or rename categories. "Ingredients" is fixed: the app uses it to spot stock-only items. */
function CategoriesModal({
  categories,
  products,
  onClose,
  onChanged,
}: {
  categories: Category[]
  products: Product[]
  onClose: () => void
  onChanged: () => Promise<void>
}) {
  const [newName, setNewName] = useState("")
  const [names, setNames] = useState<Record<number, string>>({})
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError("")
    try {
      await action()
      await onChanged()
      return true
    } catch (err) {
      setError((err as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-[#1F2925]/45 p-4">
      <div className="my-6 w-full max-w-sm rounded-md bg-white p-7 shadow-xl">
        <h2 className="font-display text-xl font-bold">Categories</h2>
        {error && <p className="mt-3 rounded bg-[#F5E7E3] px-3 py-2 text-xs text-[#A34E42]">{error}</p>}
        <div className="mt-4 space-y-2">
          {categories.map((c) => {
            const count = products.filter((p) => p.category === c.name).length
            const draft = names[c.id] ?? c.name
            return (
              <div key={c.id} className="flex items-center gap-2">
                <input
                  value={draft}
                  disabled={c.name === INGREDIENTS || busy}
                  onChange={(event) => setNames((n) => ({ ...n, [c.id]: event.target.value }))}
                  aria-label={`Name of ${c.name}`}
                  className="min-w-0 flex-1 border border-[#D9DAD5] px-3 py-2 text-xs outline-none disabled:bg-[#F3F3F1]"
                />
                <span className="w-14 text-right text-[10px] text-[#858983]">{count} items</span>
                {draft.trim() && draft.trim() !== c.name && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      run(() => api(`/categories/${c.id}`, { method: "PATCH", body: { name: draft.trim() } }))
                    }
                    className="rounded bg-[#28695E] px-2 py-1.5 text-[11px] font-bold text-white"
                  >
                    Save
                  </button>
                )}
              </div>
            )
          })}
        </div>
        <div className="mt-5 flex gap-2">
          <input
            value={newName}
            maxLength={100}
            onChange={(event) => setNewName(event.target.value)}
            placeholder="New category, e.g. Desserts"
            className="min-w-0 flex-1 border border-[#D9DAD5] px-3 py-2 text-xs outline-none"
          />
          <button
            disabled={busy || !newName.trim()}
            onClick={async () => {
              if (await run(() => api("/categories", { method: "POST", body: { name: newName.trim() } })))
                setNewName("")
            }}
            className="rounded bg-[#24302C] px-3 py-2 text-xs font-bold text-white disabled:opacity-40"
          >
            Add
          </button>
        </div>
        <button
          onClick={onClose}
          className="mt-5 w-full rounded border border-[#D9DAD5] bg-white py-3 text-sm font-bold text-[#666A65]"
        >
          Done
        </button>
      </div>
    </div>
  )
}
