import { useEffect, useState } from "react"
import { malaysiaParts } from "../lib/format"

/** Live header clock, always in Malaysia Time. */
export default function MalaysiaClock() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 15_000)
    return () => clearInterval(id)
  }, [])
  const p = malaysiaParts(now)
  return (
    <span title="Malaysia Time (UTC+8)">
      {p.day} {p.month} {p.year} · {p.hour}:{p.minute} MYT
    </span>
  )
}
