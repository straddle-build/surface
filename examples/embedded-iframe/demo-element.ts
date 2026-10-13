import { StraddleComponentElement } from '@straddlecom/runtime-client'

class StraddleDemo extends StraddleComponentElement {
  get iframeOrigin() {
    return 'http://localhost:5174'
  }
}

customElements.define('straddle-demo', StraddleDemo)
