import { useState, type FormEvent } from "react"
import { api } from "../lib/api"
import type { SessionUser } from "../lib/types"
import ModalButtons from "./ModalButtons"
import PasswordFields, { fieldClass, passwordProblem } from "./PasswordFields"

/**
 * Change your own password. `forced` = the account is still on the seeded or an
 * admin-set temporary password, so the only other choice is to sign out.
 */
export default function ChangePasswordDialog({
  user,
  forced = false,
  onDone,
  onCancel,
}: {
  user: SessionUser
  forced?: boolean
  onDone: (user: SessionUser) => void
  /** Close the dialog, or sign out when forced. */
  onCancel: () => void
}) {
  const [current, setCurrent] = useState("")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const save = async (event: FormEvent) => {
    event.preventDefault()
    if (!current) return setError("Enter your current password.")
    const problem = passwordProblem(password)
    if (problem) return setError(problem)
    if (password !== confirm) return setError("Passwords do not match.")
    if (password === current) return setError("Choose a password different from the current one.")
    setBusy(true)
    setError("")
    try {
      const { user: updated } = await api<{ user: SessionUser }>("/auth/change-password", {
        method: "POST",
        body: { currentPassword: current, newPassword: password },
      })
      onDone(updated)
    } catch (err) {
      setError((err as Error).message)
      setBusy(false)
    }
  }
  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-[#1F2925]/45 p-4">
      <form onSubmit={save} noValidate className="my-6 w-full max-w-sm rounded-md bg-white p-7 text-center shadow-xl">
        <h2 className="mt-2 font-display text-xl font-bold">{forced ? "Choose your own password" : "Change password"}</h2>
        <p className="mt-1 text-xs text-[#757973]">
          {forced
            ? "You signed in with a temporary password. Set a new one only you know before continuing."
            : `${user.name} · ${user.email}`}
        </p>
        {error && (
          <p role="alert" className="mt-3 rounded bg-[#F5E7E3] px-3 py-2 text-left text-xs text-[#A34E42]">
            {error}
          </p>
        )}
        <label className="mt-4 block text-left text-xs font-bold">
          {forced ? "Temporary password" : "Current password"}
          <input
            type="password"
            autoComplete="current-password"
            autoFocus
            value={current}
            onChange={(event) => setCurrent(event.target.value)}
            className={fieldClass}
          />
        </label>
        <PasswordFields
          label="New password"
          password={password}
          setPassword={setPassword}
          confirm={confirm}
          setConfirm={setConfirm}
        />
        <ModalButtons
          busy={busy}
          label="Save password"
          busyLabel="Saving…"
          onClose={onCancel}
          cancelLabel={forced ? "Sign out" : "Cancel"}
        />
      </form>
    </div>
  )
}
