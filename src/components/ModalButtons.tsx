
export default function ModalButtons({ busy, label, busyLabel, onClose }: { busy: boolean; label: string; busyLabel: string; onClose: () => void }) {
  return (
    <>
      <button
        type="submit"
        disabled={busy}
        className="mt-5 w-full rounded bg-[#28695E] py-3 text-sm font-bold text-white disabled:opacity-60"
      >
        {busy ? busyLabel : label}
      </button>
      <button
        type="button"
        onClick={onClose}
        className="mt-3 w-full rounded border border-[#D9DAD5] bg-white py-3 text-sm font-bold text-[#666A65]"
      >
        Cancel
      </button>
    </>
  )
}
