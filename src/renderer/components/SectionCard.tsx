import type { ReactNode } from 'react'

export default function SectionCard({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <section className="section-card">
      <div className="section-card-head">
        <div>
          <div className="section-card-title">{title}</div>
          {subtitle ? <div className="section-card-subtitle">{subtitle}</div> : null}
        </div>
        {actions ? <div>{actions}</div> : null}
      </div>
      {children}
    </section>
  )
}

