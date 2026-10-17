import * as React from "react"

const MOBILE_BREAKPOINT = 768
const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

function getSnapshot() {
  return window.innerWidth < MOBILE_BREAKPOINT
}

export function useIsMobile() {
  // The browser is the source of truth; useSyncExternalStore subscribes without
  // a setState-in-effect cascade (and keeps the server snapshot stable).
  return React.useSyncExternalStore(
    subscribe,
    getSnapshot,
    () => false
  )
}
