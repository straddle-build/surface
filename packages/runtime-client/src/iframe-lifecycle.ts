export interface IframeHandle {
  element: HTMLIFrameElement
  destroy: () => void
}

const SANDBOX =
  'allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox'

/**
 * Mount a sandboxed iframe into `container` and observe the container for size
 * changes, forwarding them to `onSizeChange`.
 */
export function mountIframe(
  container: HTMLElement,
  src: string,
  onSizeChange: (width: number, height: number) => void,
): IframeHandle {
  const iframe = document.createElement('iframe')
  iframe.src = src
  iframe.style.cssText = 'border:none;width:100%;height:100%;display:block;'
  // allow-same-origin preserves the iframe's own origin (so it can call its own
  // backend) without granting same-origin access to the parent.
  iframe.setAttribute('sandbox', SANDBOX)
  container.appendChild(iframe)

  const observer = new ResizeObserver((entries) => {
    for (const entry of entries) {
      onSizeChange(entry.contentRect.width, entry.contentRect.height)
    }
  })
  observer.observe(container)

  return {
    element: iframe,
    destroy() {
      observer.disconnect()
      iframe.remove()
    },
  }
}
