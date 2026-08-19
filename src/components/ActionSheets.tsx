import { useState } from 'react'
import type { ReactNode } from 'react'
import { useDismissable } from '../lib/useDismissable'

/**
 * In-app replacements for window.confirm / window.prompt / window.alert.
 *
 * The audit of 2026-08-08 counted 40+ native dialog call sites across the
 * staff screens -- passwords and ban reasons typed into browser chrome, every
 * message rendered LTR with English OK/Cancel, and window.prompt() RETURNS
 * NULL SILENTLY inside the Android WebView the driver APK ships, so those
 * flows were simply dead on the app that needs them most.
 *
 * useSheets() gives a screen promise-based drop-ins:
 *
 *   const { confirmSheet, promptSheet, alertSheet, sheetElement } = useSheets()
 *   ...
 *   if (!await confirmSheet({ title: 'تقفل المطعم؟', danger: true })) return
 *   const reason = await promptSheet({ title: 'سبب الحظر' })   // null = cancelled
 *   await alertSheet('اتحفظ ✓')
 *
 * Render {sheetElement} once at the end of the screen's JSX. Escape, focus
 * trap and focus-restore come from useDismissable like every other overlay.
 *
 * Judgment call preserved from the old code: errors that already have a
 * styled banner (setActionError / setBoardError) should keep using it --
 * alertSheet is for the places that had nothing but window.alert.
 */

type ConfirmOpts = {
  title: string
  body?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** Destructive styling on the confirm button. Red = destructive ACTION. */
  danger?: boolean
}
type PromptOpts = {
  title: string
  body?: ReactNode
  placeholder?: string
  initial?: string
  multiline?: boolean
  submitLabel?: string
  cancelLabel?: string
  /** Return an Arabic error string to block submission, null/undefined to allow. */
  validate?: (value: string) => string | null | undefined
  inputMode?: 'text' | 'numeric' | 'tel'
  dir?: 'rtl' | 'ltr'
}
type AlertOpts = { title?: string; okLabel?: string }

type Active =
  | { kind: 'confirm'; opts: ConfirmOpts; resolve: (v: boolean) => void }
  | { kind: 'prompt'; opts: PromptOpts; resolve: (v: string | null) => void }
  | { kind: 'alert'; message: ReactNode; opts: AlertOpts; resolve: () => void }

function Overlay({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const ref = useDismissable<HTMLDivElement>(onClose)
  return (
    <div className="fixed inset-0 z-50 bg-black/40 grid place-items-center p-4"
      onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div ref={ref} role="dialog" aria-labelledby="action-sheet-title" aria-modal="true"
        className="card !rounded-2xl p-5 w-full max-w-sm shadow-xl">
        {children}
      </div>
    </div>
  )
}

function PromptForm({ opts, done }: { opts: PromptOpts; done: (v: string | null) => void }) {
  const [value, setValue] = useState(opts.initial ?? '')
  const [err, setErr] = useState('')
  function submit() {
    const problem = opts.validate?.(value)
    if (problem) { setErr(problem); return }
    done(value)
  }
  return (
    <>
      <h3 id="action-sheet-title" className="font-bold mb-1.5">{opts.title}</h3>
      {opts.body && <div className="text-sm text-mist mb-3 leading-relaxed">{opts.body}</div>}
      {opts.multiline ? (
        <textarea autoFocus rows={3} dir={opts.dir}
          className="field !h-auto py-3 mb-1" placeholder={opts.placeholder}
          value={value} onChange={e => { setValue(e.target.value); setErr('') }} />
      ) : (
        <input autoFocus dir={opts.dir} inputMode={opts.inputMode}
          className="field mb-1" placeholder={opts.placeholder}
          value={value} onChange={e => { setValue(e.target.value); setErr('') }}
          onKeyDown={e => { if (e.key === 'Enter') submit() }} />
      )}
      {err && <p className="text-xs text-danger font-semibold mb-1" role="alert">{err}</p>}
      <div className="flex gap-2 mt-3">
        <button className="btn-sea flex-1" onClick={submit}>{opts.submitLabel ?? 'تأكيد'}</button>
        <button className="btn-ghost" onClick={() => done(null)}>{opts.cancelLabel ?? 'إلغاء'}</button>
      </div>
    </>
  )
}

export function useSheets() {
  const [active, setActive] = useState<Active | null>(null)

  const confirmSheet = (opts: ConfirmOpts) =>
    new Promise<boolean>(resolve => setActive({ kind: 'confirm', opts, resolve }))
  const promptSheet = (opts: PromptOpts) =>
    new Promise<string | null>(resolve => setActive({ kind: 'prompt', opts, resolve }))
  const alertSheet = (message: ReactNode, opts: AlertOpts = {}) =>
    new Promise<void>(resolve => setActive({ kind: 'alert', message, opts, resolve }))

  function finish(value: boolean | string | null | undefined) {
    if (!active) return
    setActive(null)
    if (active.kind === 'confirm') active.resolve(!!value)
    else if (active.kind === 'prompt') active.resolve(typeof value === 'string' ? value : null)
    else active.resolve()
  }

  let sheetElement: ReactNode = null
  if (active?.kind === 'confirm') {
    const o = active.opts
    sheetElement = (
      <Overlay onClose={() => finish(false)}>
        <h3 className="font-bold mb-1.5">{o.title}</h3>
        {o.body && <div className="text-sm text-mist mb-3 leading-relaxed">{o.body}</div>}
        <div className="flex gap-2 mt-3">
          <button
            className={`flex-1 ${o.danger ? 'btn bg-danger text-white hover:bg-danger' : 'btn-sea'}`}
            onClick={() => finish(true)}>
            {o.confirmLabel ?? 'تأكيد'}
          </button>
          <button className="btn-ghost" onClick={() => finish(false)}>{o.cancelLabel ?? 'إلغاء'}</button>
        </div>
      </Overlay>
    )
  } else if (active?.kind === 'prompt') {
    sheetElement = (
      <Overlay onClose={() => finish(null)}>
        <PromptForm opts={active.opts} done={v => finish(v)} />
      </Overlay>
    )
  } else if (active?.kind === 'alert') {
    sheetElement = (
      <Overlay onClose={() => finish(undefined)}>
        {active.opts.title && <h3 className="font-bold mb-1.5">{active.opts.title}</h3>}
        <div className="text-sm leading-relaxed">{active.message}</div>
        <div className="flex mt-4">
          <button className="btn-sea flex-1" onClick={() => finish(undefined)}>
            {active.opts.okLabel ?? 'تمام'}
          </button>
        </div>
      </Overlay>
    )
  }

  return { confirmSheet, promptSheet, alertSheet, sheetElement }
}
