import { useState, type FormEvent } from "react"
import Icon from "../components/Icon"
import { api } from "../lib/api"
import { image } from "../lib/images"
import { SessionUser } from "../lib/types"

export default function Login({ onLogin }: { onLogin: (user: SessionUser) => void }) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!email.trim() || !password) return setError("Enter your email and password.")
    setBusy(true)
    setError("")
    try {
      const { user } = await api<{ user: SessionUser }>("/auth/login", {
        method: "POST",
        body: { email: email.trim(), password },
      })
      onLogin(user)
    } catch (err) {
      setError((err as Error).message)
      setPassword("")
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className="grid min-h-screen grid-cols-[1fr_1fr] bg-[#F5F4F0]">
      <section className="relative m-4 overflow-hidden">
        <img
          src={image.store}
          alt="Juniper Cafe counter"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-[#183B34]/65" />
        <div className="relative flex h-full flex-col justify-between p-10 text-white">
          <div className="font-display text-xl font-bold">Juniper Cafe</div>
          <div>
            <p className="text-xs font-bold uppercase tracking-[.18em] text-white/65">
              Coffee · Bakery · Kitchen
            </p>
            <h1 className="mt-4 max-w-lg font-display text-5xl font-bold leading-[1.05] tracking-[-.04em]">
              Every sale, every bean,
              <br />
              accounted for.
            </h1>
            <p className="mt-5 max-w-md text-sm leading-relaxed text-white/70">
              Sales, stock and demand forecasts for Juniper Cafe in one place.
            </p>
          </div>
        </div>
      </section>
      <section className="flex items-center justify-center px-16">
        <form className="w-full max-w-sm" onSubmit={submit} noValidate>
          <p className="text-xs font-bold uppercase tracking-[.16em] text-[#28695E]">
            Juniper Cafe POS
          </p>
          <h2 className="mt-3 font-display text-3xl font-bold">
            Sign in to workspace
          </h2>
          <p className="mt-2 text-sm text-[#757973]">
            Use the account your administrator created for you.
          </p>
          {error && (
            <p
              role="alert"
              className="mt-6 rounded bg-[#F5E7E3] px-3 py-2 text-xs text-[#A34E42]"
            >
              {error}
            </p>
          )}
          <label className="mt-6 block text-xs font-bold">
            Email
            <input
              type="email"
              autoComplete="username"
              autoFocus
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="mt-2 w-full border border-[#D9DAD5] bg-white px-4 py-3.5 text-sm outline-none focus:border-[#28695E]"
            />
          </label>
          <label className="mt-4 block text-xs font-bold">
            Password
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-2 w-full border border-[#D9DAD5] bg-white px-4 py-3.5 text-sm outline-none focus:border-[#28695E]"
            />
          </label>
          <button
            type="submit"
            disabled={busy}
            className="mt-6 flex w-full items-center justify-between bg-[#28695E] px-5 py-4 text-sm font-bold text-white disabled:opacity-60"
          >
            <span>{busy ? "Signing in…" : "Sign in"}</span>
            <Icon name="arrow" />
          </button>
          <p className="mt-4 flex items-center gap-2 text-[11px] text-[#858983]">
            <Icon name="lock" size={13} />
            Passwords are hashed with bcrypt and never stored in plaintext
          </p>
        </form>
      </section>
    </main>
  )
}
