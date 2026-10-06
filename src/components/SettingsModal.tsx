import { useEffect, useState } from 'react'
import { useEditorStore } from '../store/editorStore'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 15 }}>
      <label style={{ display: 'block', marginBottom: 5, fontSize: 13 }}>{label}</label>
      {children}
    </div>
  )
}

function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return <input type="color" value={value} onChange={(e) => onChange(e.target.value)} style={{ width: '100%', height: 30 }} />
}

/** Viewport / lighting settings modal. */
export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const settings = useEditorStore((state) => state.settings)
  const setSettings = useEditorStore((state) => state.setSettings)
  const [tab, setTab] = useState<'General' | 'Lighting' | 'Performance'>('General')

  // Reset to General whenever the modal opens.
  useEffect(() => {
    if (isOpen) setTab('General')
  }, [isOpen])

  if (!isOpen) return null

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2000,
      }}
      onClick={onClose}
    >
      <div
        style={{
          background: 'var(--color-bg-panel)',
          color: 'var(--color-text)',
          padding: 20,
          borderRadius: 8,
          width: 360,
          boxShadow: 'var(--shadow-modal)',
          border: '1px solid var(--color-border)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ marginTop: 0 }}>Editor Settings</h3>

        <div style={{ display: 'flex', gap: 10, marginBottom: 15, borderBottom: '1px solid var(--color-border)', paddingBottom: 10 }}>
          <button
            onClick={() => setTab('General')}
            style={{
              background: tab === 'General' ? 'var(--color-accent-menu)' : 'transparent',
              border: 'none',
              color: 'var(--color-text)',
              padding: '5px 10px',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            General
          </button>
          <button
            onClick={() => setTab('Lighting')}
            style={{
              background: tab === 'Lighting' ? 'var(--color-accent-menu)' : 'transparent',
              border: 'none',
              color: 'var(--color-text)',
              padding: '5px 10px',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            Lighting
          </button>
          <button
            onClick={() => setTab('Performance')}
            style={{
              background: tab === 'Performance' ? 'var(--color-accent-menu)' : 'transparent',
              border: 'none',
              color: 'var(--color-text)',
              padding: '5px 10px',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            Performance
          </button>
        </div>

        {tab === 'General' && (
          <>
            <Field label="Background Color">
              <ColorInput value={settings.backgroundColor} onChange={(v) => setSettings({ backgroundColor: v })} />
            </Field>
            <Field label="Grid Color">
              <ColorInput value={settings.gridColor} onChange={(v) => setSettings({ gridColor: v })} />
            </Field>
            <Field label={`Grid Size (${settings.gridSize})`}>
              <input
                type="range"
                min={100}
                max={2000}
                step={100}
                value={settings.gridSize}
                onChange={(e) => setSettings({ gridSize: parseInt(e.target.value, 10) })}
                style={{ width: '100%' }}
              />
            </Field>
            <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', marginBottom: 10 }}>
              <input type="checkbox" checked={settings.showGrid} onChange={(e) => setSettings({ showGrid: e.target.checked })} style={{ marginRight: 10 }} />
              Show Grid
            </label>
            <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={settings.showAxes} onChange={(e) => setSettings({ showAxes: e.target.checked })} style={{ marginRight: 10 }} />
              Show Axes
            </label>

            <h4 style={{ marginBottom: 8, borderTop: '1px solid var(--color-border)', paddingTop: 12 }}>Movement</h4>
            <Field label={`Move increment (LDU) — snap & arrow-key nudge step (${settings.moveIncrement})`}>
              <input
                type="number"
                min={0.05}
                max={100}
                step={0.25}
                value={settings.moveIncrement}
                onChange={(e) => {
                  const v = parseFloat(e.target.value)
                  setSettings({ moveIncrement: Number.isFinite(v) ? Math.max(v, 0.05) : settings.moveIncrement })
                }}
                style={{ width: '100%', background: 'var(--color-bg-input)', color: 'var(--color-text)', border: '1px solid var(--color-border)', borderRadius: 4, padding: '4px 6px' }}
              />
            </Field>
            <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
              <input type="checkbox" checked={settings.moveSnap} onChange={(e) => setSettings({ moveSnap: e.target.checked })} style={{ marginRight: 10 }} />
              Snap movement to the increment
            </label>
          </>
        )}

        {tab === 'Lighting' && (
          <>
            <Field label="Ambient Color">
              <ColorInput value={settings.ambientColor} onChange={(v) => setSettings({ ambientColor: v })} />
            </Field>
            <Field label={`Ambient Intensity (${settings.ambientIntensity.toFixed(1)})`}>
              <input
                type="range"
                min={0}
                max={2}
                step={0.1}
                value={settings.ambientIntensity}
                onChange={(e) => setSettings({ ambientIntensity: parseFloat(e.target.value) })}
                style={{ width: '100%' }}
              />
            </Field>
            <Field label="Directional Color">
              <ColorInput value={settings.directionalColor} onChange={(v) => setSettings({ directionalColor: v })} />
            </Field>
            <Field label={`Directional Intensity (${settings.directionalIntensity.toFixed(1)})`}>
              <input
                type="range"
                min={0}
                max={2}
                step={0.1}
                value={settings.directionalIntensity}
                onChange={(e) => setSettings({ directionalIntensity: parseFloat(e.target.value) })}
                style={{ width: '100%' }}
              />
            </Field>
          </>
        )}

        {tab === 'Performance' && (
          <>
            <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={settings.liveSync}
                onChange={(e) => setSettings({ liveSync: e.target.checked })}
                style={{ marginRight: 10 }}
              />
              Live text sync
            </label>
            <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 6, marginBottom: 0 }}>
              Update the text editor live while dragging vertices or parts in the
              viewport and blueprint. Disable this to improve performance on
              large models (edits then only apply when you release the mouse).
            </p>
          </>
        )}

        <div style={{ textAlign: 'right' }}>
          <button onClick={onClose} style={{ background: 'var(--color-accent-menu)' }}>Close</button>
        </div>
      </div>
    </div>
  )
}
