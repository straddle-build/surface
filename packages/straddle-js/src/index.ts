import { StraddleBridgeElement } from './bridge-element'

export { StraddleBridgeElement }
export { STRADDLE_MODES } from '@straddlecom/runtime-client'
export type { StraddleMode } from '@straddlecom/runtime-client'
// The Bridge vocabulary lives in @straddlecom/surface-contracts (shared with
// the surface app); re-exported here so straddle-js's public API is unchanged.
export { BRIDGE_OAUTH_MODES } from '@straddlecom/surface-contracts/bridge'
export type {
  BridgeInitOptions,
  BridgeOAuthMode,
} from '@straddlecom/surface-contracts/bridge'
export type {
  StraddleBridgeEventMap,
  StraddleCompleteDetail,
  StraddleErrorCode,
  StraddleErrorDetail,
  StraddleExitDetail,
  StraddleReadyDetail,
} from './bridge-element'

declare global {
  interface HTMLElementTagNameMap {
    'straddle-bridge': StraddleBridgeElement
  }
}
