import { GlobalRegistrator } from '@happy-dom/global-registrator'

GlobalRegistrator.register()

// happy-dom doesn't implement ResizeObserver; provide a no-op default so the
// runtime can construct. Tests that exercise resize install their own.
if (!('ResizeObserver' in globalThis)) {
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
}
