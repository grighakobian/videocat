import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { MissingBridge } from './components/MissingBridge'
import './styles.css'

// `window.videocat` is created by the preload script, so it only exists inside the app
// window. Opening the renderer's dev-server URL in a browser gives a page with no bridge,
// and every component assumes it is there — say so plainly instead of throwing.
const hasBridge = typeof window.videocat === 'object' && window.videocat !== null

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>{hasBridge ? <App /> : <MissingBridge />}</StrictMode>
)
