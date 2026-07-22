export function Loader({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="loader-wrap" role="status" aria-live="polite">
      <div className="loader-bars" aria-hidden>
        <span />
        <span />
        <span />
      </div>
      <p>{label}</p>
    </div>
  )
}
