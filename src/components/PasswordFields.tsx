
// Same rule as the server (server/src/routes/admin.js), checked here for a quicker message.
export const passwordProblem = (password: string) =>
  password.length < 10
    ? "Password must be at least 10 characters."
    : !/[A-Za-z]/.test(password) || !/\d/.test(password)
      ? "Password needs letters and numbers."
      : ""

export const fieldClass =
  "mt-2 w-full border border-[#D9DAD5] bg-white px-4 py-3 text-sm outline-none focus:border-[#28695E]"

export default function PasswordFields({
  label,
  password,
  setPassword,
  confirm,
  setConfirm,
}: {
  label: string
  password: string
  setPassword: (value: string) => void
  confirm: string
  setConfirm: (value: string) => void
}) {
  return (
    <>
      <label className="mt-3 block text-left text-xs font-bold">
        {label}
        <input
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className={fieldClass}
        />
        <span className="mt-1 block text-[10px] font-normal text-[#858983]">
          At least 10 characters, with letters and numbers.
        </span>
      </label>
      <label className="mt-3 block text-left text-xs font-bold">
        Confirm password
        <input
          type="password"
          autoComplete="new-password"
          value={confirm}
          onChange={(event) => setConfirm(event.target.value)}
          className={fieldClass}
        />
      </label>
    </>
  )
}
