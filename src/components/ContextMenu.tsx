import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export interface ContextMenuItem {
  label: string
  action: () => void
  disabled?: boolean
  danger?: boolean
  separatorBefore?: boolean
  shortcut?: string
}

export interface ContextMenuState {
  x: number
  y: number
  items: ContextMenuItem[]
}

/** Local right-click menu state for a component. */
export function useContextMenu() {
  const [menu, setMenu] = useState<ContextMenuState | null>(null)
  const open = (x: number, y: number, items: ContextMenuItem[]) => {
    if (items.length === 0) return
    setMenu({ x, y, items })
  }
  const close = () => setMenu(null)
  return { menu, open, close }
}

/** A floating context menu, positioned at the pointer and clamped to the viewport. */
export function ContextMenu({ menu, onClose }: { menu: ContextMenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x: menu.x, y: menu.y })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    let x = menu.x
    let y = menu.y
    if (x + rect.width > window.innerWidth - 4) x = window.innerWidth - rect.width - 4
    if (y + rect.height > window.innerHeight - 4) y = window.innerHeight - rect.height - 4
    setPos({ x: Math.max(0, x), y: Math.max(0, y) })
  }, [menu])

  useEffect(() => {
    const onDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    const onScroll = () => onClose()
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onClose)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [onClose])

  return (
    <div className="context-menu" ref={ref} style={{ left: pos.x, top: pos.y }} role="menu">
      {menu.items.map((item, index) => (
        <div key={index}>
          {item.separatorBefore && <div className="context-menu-separator" />}
          <button
            type="button"
            role="menuitem"
            className={`context-menu-item${item.danger ? ' danger' : ''}${item.disabled ? ' disabled' : ''}`}
            disabled={item.disabled}
            onClick={() => {
              item.action()
              onClose()
            }}
          >
            <span className="context-menu-label">{item.label}</span>
            {item.shortcut && <span className="context-menu-shortcut">{item.shortcut}</span>}
          </button>
        </div>
      ))}
    </div>
  )
}
