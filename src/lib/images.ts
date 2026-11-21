import { Product } from "./types"

export const image = {
  coffee:
    "https://images.unsplash.com/photo-1564327367919-cb377ea6a88f?auto=format&fit=crop&w=700&q=85",
  bakery:
    "https://images.unsplash.com/photo-1704283735270-f973e7e9c14e?auto=format&fit=crop&w=700&q=85",
  meal: "https://images.unsplash.com/photo-1730871082582-49e083b500a1?auto=format&fit=crop&w=700&q=85",
  pantry:
    "https://images.unsplash.com/photo-1683771419613-0a608d8f5cf6?auto=format&fit=crop&w=700&q=85",
  cake: "https://images.unsplash.com/photo-1529942458412-eda69f76291d?auto=format&fit=crop&w=700&q=85",
  store:
    "https://images.unsplash.com/photo-1528699633788-424224dc89b5?auto=format&fit=crop&w=1400&q=85",
}

/** Stock photos offered in the product form (the store photo is for the login page). */
export const productPhotos = Object.entries(image).filter(([key]) => key !== "store")

export const photoOf = (product: Product) => product.image || image.pantry
