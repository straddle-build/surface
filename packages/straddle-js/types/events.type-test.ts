// Compile-time assertions for the typed listener overloads. Verified by
// `tsc --noEmit`, NOT by `bun test` (hence the .type-test.ts suffix). Runs the
// same checks against the handwritten declaration a consumer sees and against
// the implementation, so neither can drift on its own.
import type {
  StraddleBridgeElement as Declared,
  StraddleBridgeEventMap,
  StraddleCompleteDetail,
  StraddleErrorCode,
  StraddleErrorDetail,
  StraddleExitDetail,
  StraddleReadyDetail,
} from './index'
import type { StraddleBridgeElement as Implemented } from '../src/index'
import type { JSX as ReactJSX } from 'react'

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false
type Expect<T extends true> = T

// Each event's `detail` is the documented payload — no more, no less.
type _ready = Expect<Equal<StraddleReadyDetail, Record<never, never>>>
type _complete = Expect<
  Equal<StraddleCompleteDetail, { data?: Record<string, unknown> }>
>
type _exit = Expect<Equal<StraddleExitDetail, { reason?: string }>>
type _error = Expect<
  Equal<StraddleErrorDetail, { code: StraddleErrorCode; message: string }>
>
type _eventNames = Expect<
  Equal<
    keyof StraddleBridgeEventMap,
    'straddleready' | 'straddlecomplete' | 'straddleexit' | 'straddleerror'
  >
>

// The typing is scoped to the element: the global event map is untouched, so
// a plain HTMLElement still sees `straddleerror` as an unknown event name.
type _noGlobalPollution = Expect<
  Equal<Extract<keyof HTMLElementEventMap, keyof StraddleBridgeEventMap>, never>
>

// Overloads on a union receiver collapse to the common HTMLElement signatures,
// so the two classes are exercised separately.
// The React JSX entry is opt-in: this program never includes types/react.d.ts
// (tsconfig.json excludes it), so with React's own types present the element
// is still unknown to JSX. tsconfig.react.json covers the opted-in side.
type _jsxIsOptIn = Expect<
  Equal<
    'straddle-bridge' extends keyof ReactJSX.IntrinsicElements ? true : false,
    false
  >
>

function exercise(el: Declared): void {
  // Listener callbacks narrow `ev` to the matching CustomEvent — no casts.
  el.addEventListener('straddleerror', (e) => {
    const code: StraddleErrorCode = e.detail.code
    const message: string = e.detail.message
    void [code, message]
  })
  el.addEventListener('straddlecomplete', (e) => {
    const data: Record<string, unknown> | undefined = e.detail.data
    void data
  })
  el.addEventListener('straddleexit', (e) => {
    const reason: string | undefined = e.detail.reason
    void reason
  })
  el.addEventListener('straddleready', (e) => {
    // @ts-expect-error — the ready payload is empty
    e.detail.anything
  })

  // Wrong field for the event is rejected.
  el.addEventListener('straddleerror', (e) => {
    // @ts-expect-error — `reason` belongs to straddleexit, not straddleerror
    e.detail.reason
  })

  // Inherited DOM events keep their own typing.
  el.addEventListener('click', (e) => {
    const x: number = e.clientX
    void x
  })

  // Untyped event names still work (the string fallback overload).
  el.addEventListener('something-else', (e) => {
    const ev: Event = e
    void ev
  })

  // removeEventListener carries the same overloads.
  const onError = (e: CustomEvent<StraddleErrorDetail>) => void e.detail.code
  el.addEventListener('straddleerror', onError)
  el.removeEventListener('straddleerror', onError)
  // @ts-expect-error — a straddleerror listener cannot be removed as a straddleexit one
  el.removeEventListener('straddleexit', onError)

  // Options are accepted in every position.
  el.addEventListener('straddleerror', onError, { once: true })
  el.addEventListener('straddleerror', onError, true)
}

// The implementation narrows identically (its overloads are what the
// declaration mirrors).
function exerciseImplementation(el: Implemented): void {
  el.addEventListener('straddleerror', (e) => {
    const code: StraddleErrorCode = e.detail.code
    void code
  })
  el.addEventListener('straddlecomplete', (e) => {
    const data: Record<string, unknown> | undefined = e.detail.data
    void data
  })
  el.addEventListener('straddleexit', (e) => {
    const reason: string | undefined = e.detail.reason
    void reason
  })
  el.addEventListener('straddleready', (e) => {
    // @ts-expect-error — the ready payload is empty
    e.detail.anything
  })
  const onError = (e: CustomEvent<StraddleErrorDetail>) => void e.detail.code
  el.removeEventListener('straddleerror', onError)
  // @ts-expect-error — a straddleerror listener cannot be removed as a straddleexit one
  el.removeEventListener('straddleexit', onError)
}

// Off the element, a listener typed for the map cannot be attached to a plain
// HTMLElement's typed overloads without going through the string fallback,
// which hands back a bare Event — proof the map is not global.
function plain(el: HTMLElement): void {
  el.addEventListener('straddleerror', (e) => {
    // @ts-expect-error — `detail` does not exist on Event
    e.detail
  })
}

export type _Assertions = [
  _ready,
  _complete,
  _exit,
  _error,
  _eventNames,
  _noGlobalPollution,
  _jsxIsOptIn,
  typeof exercise,
  typeof exerciseImplementation,
  typeof plain,
]
