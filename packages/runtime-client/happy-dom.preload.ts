import { GlobalRegistrator } from '@happy-dom/global-registrator'

// Tests point iframes at unresolvable hosts and drive the handshake with
// synthetic postMessage — stop happy-dom from actually fetching iframe srcs,
// which only produces NetworkError noise in the test output. The navigation
// setting (unlike the deprecated disableIframePageLoading) is silent: the
// iframe keeps its URL and load event instead of logging a NotSupportedError.
GlobalRegistrator.register({
  settings: { navigation: { disableChildFrameNavigation: true } },
})

// happy-dom doesn't implement ResizeObserver; provide a no-op default so the
// component lifecycle can mount. Tests that exercise resize install their own.
if (!('ResizeObserver' in globalThis)) {
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver =
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
}
