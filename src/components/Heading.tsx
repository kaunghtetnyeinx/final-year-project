
export type HeadingProps = {
  title: string
  subtitle: string
}

export default function Heading({ title, subtitle }: HeadingProps) {
  return (
    <header>
      <h1 className="font-display text-[28px] font-bold tracking-[-.035em]">
        {title}
      </h1>
      <p className="mt-1 text-xs text-[#7E817C]">{subtitle}</p>
    </header>
  )
}
