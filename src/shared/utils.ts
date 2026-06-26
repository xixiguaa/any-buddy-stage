export function nowIso() {
  return new Date().toISOString()
}

export function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`
}

export function toTitleFromPath(path: string) {
  const tail = path.replace(/[/\\]+$/, '').split(/[/\\]/).filter(Boolean).pop()
  return tail || 'Untitled'
}

