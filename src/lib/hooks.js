import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useBlocker } from 'react-router-dom'
import { describeError } from '../api'

// ── Debounce fast-changing values (search boxes, dynamic inputs) ──────────
export function useDebounced(value, delay = 350) {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

// ── Form draft protection ────────────────────────────────────────────────
// Chrome can discard a background tab and reload it when you return — any
// unsaved form would be lost. These keep a per-tab draft in sessionStorage
// (which survives both reloads and tab discards) so the form restores
// exactly as the user left it.
export function saveDraft(key, value) {
  try { sessionStorage.setItem('aba_draft:' + key, JSON.stringify({ value, at: Date.now() })) } catch {}
}
export function loadDraft(key, maxAgeMs = 86400000) {
  try {
    const d = JSON.parse(sessionStorage.getItem('aba_draft:' + key) || 'null')
    if (d && Date.now() - d.at < maxAgeMs) return d.value
  } catch {}
  return null
}
export function clearDraft(key) {
  try { sessionStorage.removeItem('aba_draft:' + key) } catch {}
}

// ── Central async-action wrapper ──────────────────────────────────────────
// Gives every button the same defenses:
//   • double-click / re-entrancy protection (busyRef gate)
//   • a `busy` flag for disabled + spinner states
//   • one consistent error toast (friendly, non-technical)
//   • optional success toast + onDone callback (usually a list reload)
export function useAction(fn, { toast, successMsg, onDone } = {}) {
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const fnRef = useRef(fn)
  fnRef.current = fn
  const onDoneRef = useRef(onDone)
  onDoneRef.current = onDone

  const run = useCallback(
    async (...args) => {
      if (busyRef.current) return // action already in flight — swallow the extra click
      busyRef.current = true
      setBusy(true)
      try {
        const result = await fnRef.current(...args)
        if (successMsg) toast?.(typeof successMsg === 'function' ? successMsg(result) : successMsg)
        onDoneRef.current?.(result)
        return result
      } catch (e) {
        toast?.(describeError(e), 'error')
        return undefined // callers can check for undefined without try/catch
      } finally {
        busyRef.current = false
        setBusy(false)
      }
    },
    [toast, successMsg] // fn/onDone read through refs → safe to pass inline closures
  )
  return { run, busy }
}

// ── Unsaved-changes guard ─────────────────────────────────────────────────
// Covers both browser close/refresh (beforeunload) and in-app navigation
// (React Router blocker — requires the data router in App.jsx).
export function useDirtyGuard(dirty, { title = 'Discard unsaved changes?', body = 'You have unsaved changes on this page that will be lost.' } = {}) {
  useEffect(() => {
    if (!dirty) return
    const handler = (e) => {
      e.preventDefault()
      e.returnValue = '' // required for Chrome
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  const blocker = useBlocker(!!dirty)
  useEffect(() => {
    if (blocker?.state !== 'blocked') return
    const leave = window.confirm(`${title}\n\n${body}\n\nClick OK to leave without saving, or Cancel to stay.`)
    if (leave) blocker.proceed()
    else blocker.reset()
  }, [blocker, title, body])
}

// ── Offline detection (drives the global banner in Layout) ────────────────
export function useOnline() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine)
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}

// ── Discards responses from superseded requests ───────────────────────────
// The classic search/filter race: two requests in flight, the older one
// resolves last and paints stale data. Take a ticket with `next()` before the
// request, then check `isCurrent(ticket)` — checking must never mint a new
// ticket (a previous version incremented on every check and discarded
// everything, including the fresh response).
export function useLatestRequest() {
  const idRef = useRef(0)
  return useMemo(() => ({
    next: () => ++idRef.current,
    isCurrent: (id) => id === idRef.current,
  }), [])
}
