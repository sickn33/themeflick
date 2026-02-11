export function Loader({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="loader-wrap" role="status" aria-live="polite">
      <div className="loader-orbit" />
      <p>{label}</p>
    </div>
  )
}
