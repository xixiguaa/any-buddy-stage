export default function StatusPill({ value }: { value: string }) {
  return <span className={`status-chip status-${value}`}>{value.replace('_', ' ')}</span>
}

