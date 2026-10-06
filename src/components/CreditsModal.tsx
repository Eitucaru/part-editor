import { useEffect } from 'react'
import { CREDIT_CATEGORIES } from '../lib/credits'

interface CreditsModalProps {
  isOpen: boolean
  onClose: () => void
}

/**
 * Central "built on top of" window: an in-depth list of every project and
 * tool this app builds on, with a link to each one's source.
 */
export function CreditsModal({ isOpen, onClose }: CreditsModalProps) {
  useEffect(() => {
    if (!isOpen) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen, onClose])

  if (!isOpen) return null

  return (
    <div className="credits-overlay" onClick={onClose}>
      <div className="credits-modal" onClick={(e) => e.stopPropagation()}>
        <div className="credits-header">
          <h2 className="credits-title">Built on top of</h2>
          <button className="credits-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <p className="credits-intro">
          Part Editor v2 is an in-browser LDraw part editor. It builds on these
          open-source projects and standards:
        </p>
        <div className="credits-scroll">
          {CREDIT_CATEGORIES.map((category) => (
            <section key={category.title} className="credits-section">
              <h3 className="credits-section-title">{category.title}</h3>
              <ul className="credits-list">
                {category.projects.map((project) => (
                  <li key={project.name} className="credit-item">
                    <div className="credit-item-main">
                      <a className="credit-name" href={project.url} target="_blank" rel="noreferrer noopener">
                        {project.name} ↗
                      </a>
                      <div className="credit-description">{project.description}</div>
                    </div>
                    <div className="credit-role">{project.role}</div>
                    {project.links && project.links.length > 0 && (
                      <div className="credit-links">
                        {project.links.map((link) => (
                          <a key={link.url} className="credit-link" href={link.url} target="_blank" rel="noreferrer noopener">
                            {link.label} ↗
                          </a>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </div>
    </div>
  )
}
