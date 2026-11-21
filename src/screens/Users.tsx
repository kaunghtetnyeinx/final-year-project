import { useEffect, useState, type FormEvent } from "react"
import Heading from "../components/Heading"
import ModalButtons from "../components/ModalButtons"
import PasswordFields, { fieldClass, passwordProblem } from "../components/PasswordFields"
import Table from "../components/Table"
import { api } from "../lib/api"
import { myDate } from "../lib/format"
import { Role, StaffUser } from "../lib/types"

export default function Users({ currentUserId }: { currentUserId: number }) {
  const [users, setUsers] = useState<StaffUser[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState("")
  const [addOpen, setAddOpen] = useState(false)
  const [resetFor, setResetFor] = useState<StaffUser | null>(null)

  useEffect(() => {
    api<{ users: StaffUser[] }>("/users")
      .then(({ users }) => setUsers(users))
      .catch((err) => setError((err as Error).message))
      .finally(() => setLoading(false))
  }, [])

  const replace = (user: StaffUser) =>
    setUsers((current) => current.map((u) => (u.id === user.id ? user : u)))

  const toggleActive = async (user: StaffUser) => {
    setError("")
    try {
      const { user: updated } = await api<{ user: StaffUser }>(`/users/${user.id}`, {
        method: "PATCH",
        body: { isActive: !user.isActive },
      })
      replace(updated)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const rows = users.map((u) => [
    u.code,
    u.name,
    u.email,
    u.role,
    u.isActive ? "Active" : "Inactive",
    myDate(new Date(u.createdAt)),
  ])

  return (
    <div className="p-8">
      <Heading
        title="Users"
        subtitle="Staff accounts and application roles. Deactivate accounts to preserve audit history."
      />
      <div className="mt-6 flex justify-end">
        <button
          className="rounded bg-[#24302C] px-4 py-2.5 text-xs font-bold text-white"
          onClick={() => setAddOpen(true)}
        >
          + Add staff user
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-4 rounded bg-[#F5E7E3] px-3 py-2 text-xs text-[#A34E42]">
          {error}
        </p>
      )}
      <Table
        headers={["User ID", "Full name", "Email", "Role", "Status", "Created"]}
        rows={rows}
        empty={loading ? "Loading users…" : "No users found."}
        actionWidth={150}
        action={(index) => {
          const user = users[index]
          const self = user.id === currentUserId
          return (
            <div className="flex gap-1">
              <button
                onClick={() => setResetFor(user)}
                className="rounded border border-[#D9DAD5] px-2 py-1 text-[10px] font-bold text-[#666A65]"
                title="Set a new password"
              >
                Password
              </button>
              <button
                disabled={self}
                onClick={() => toggleActive(user)}
                className="rounded border border-[#D9DAD5] px-2 py-1 text-[10px] font-bold text-[#666A65] disabled:opacity-30"
                title={self ? "You cannot deactivate your own account" : undefined}
              >
                {user.isActive ? "Disable" : "Enable"}
              </button>
            </div>
          )
        }}
      />
      {addOpen && (
        <AddUserModal
          onClose={() => setAddOpen(false)}
          onAdded={(user) => {
            setUsers((current) => [...current, user])
            setAddOpen(false)
          }}
        />
      )}
      {resetFor && (
        <ResetPasswordModal
          user={resetFor}
          onClose={() => setResetFor(null)}
          onDone={(user) => {
            replace(user)
            setResetFor(null)
          }}
        />
      )}
    </div>
  )
}

export function AddUserModal({
  onClose,
  onAdded,
}: {
  onClose: () => void
  onAdded: (user: StaffUser) => void
}) {
  const [fullName, setFullName] = useState("")
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<Role>("STAFF")
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const add = async (event: FormEvent) => {
    event.preventDefault()
    const cleanEmail = email.trim().toLowerCase()
    if (!fullName.trim() || !cleanEmail) return setError("Full name and email are required.")
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail))
      return setError("Enter a valid email address.")
    const problem = passwordProblem(password)
    if (problem) return setError(problem)
    if (password !== confirm) return setError("Passwords do not match.")
    setBusy(true)
    setError("")
    try {
      const { user } = await api<{ user: StaffUser }>("/users", {
        method: "POST",
        body: { name: fullName.trim(), email: cleanEmail, role, password },
      })
      onAdded(user)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#1F2925]/45 p-6">
      <form
        onSubmit={add}
        noValidate
        className="w-full max-w-sm rounded-md bg-white p-7 text-center shadow-xl"
      >
        <h2 className="mt-4 font-display text-xl font-bold">Add staff user</h2>
        {error && (
          <p className="mt-3 rounded bg-[#F5E7E3] px-3 py-2 text-left text-xs text-[#A34E42]">
            {error}
          </p>
        )}
        <label className="mt-4 block text-left text-xs font-bold">
          Full name
          <input
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="mt-3 block text-left text-xs font-bold">
          Email
          <input
            type="email"
            autoComplete="off"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={fieldClass}
          />
        </label>
        <label className="mt-3 block text-left text-xs font-bold">
          Role
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as Role)}
            className={fieldClass}
          >
            <option value="STAFF">Staff</option>
            <option value="ADMIN">Admin</option>
          </select>
        </label>
        <PasswordFields
          label="Password"
          password={password}
          setPassword={setPassword}
          confirm={confirm}
          setConfirm={setConfirm}
        />
        <ModalButtons busy={busy} label="Add user" busyLabel="Adding…" onClose={onClose} />
      </form>
    </div>
  )
}

export function ResetPasswordModal({
  user,
  onClose,
  onDone,
}: {
  user: StaffUser
  onClose: () => void
  onDone: (user: StaffUser) => void
}) {
  const [password, setPassword] = useState("")
  const [confirm, setConfirm] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const save = async (event: FormEvent) => {
    event.preventDefault()
    const problem = passwordProblem(password)
    if (problem) return setError(problem)
    if (password !== confirm) return setError("Passwords do not match.")
    setBusy(true)
    setError("")
    try {
      const { user: updated } = await api<{ user: StaffUser }>(`/users/${user.id}`, {
        method: "PATCH",
        body: { password },
      })
      onDone(updated)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[#1F2925]/45 p-6">
      <form
        onSubmit={save}
        noValidate
        className="w-full max-w-sm rounded-md bg-white p-7 text-center shadow-xl"
      >
        <h2 className="mt-4 font-display text-xl font-bold">Set new password</h2>
        <p className="mt-1 text-xs text-[#757973]">
          {user.name} · {user.email}
        </p>
        {error && (
          <p className="mt-3 rounded bg-[#F5E7E3] px-3 py-2 text-left text-xs text-[#A34E42]">
            {error}
          </p>
        )}
        <PasswordFields
          label="New password"
          password={password}
          setPassword={setPassword}
          confirm={confirm}
          setConfirm={setConfirm}
        />
        <ModalButtons busy={busy} label="Save password" busyLabel="Saving…" onClose={onClose} />
      </form>
    </div>
  )
}
