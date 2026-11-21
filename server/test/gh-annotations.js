// node:test reporter for GitHub Actions: each failing test becomes an error annotation,
// so failures show on the commit and in the checks API without opening the full log.
const escape = (text) => String(text).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A")

export default async function* githubAnnotations(source) {
  for await (const event of source) {
    if (event.type !== "test:fail") continue
    const { name, details, file, line } = event.data
    // Suites fail too when a test inside them fails; only report the test itself.
    if (details?.type === "suite") continue
    const error = details?.error?.cause ?? details?.error
    const message = error?.message ?? String(error)
    const where = file ? ` file=${file.replace(process.cwd() + "/", "")}${line ? `,line=${line}` : ""}` : ""
    yield `::error${where},title=${escape(name)}::${escape(message.slice(0, 2000))}\n`
  }
}
