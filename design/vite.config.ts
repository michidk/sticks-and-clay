import { mergeConfig } from 'vite'
import base from '../vite.config'

// Capture the public landing page with the read-only UI and the existing local database.
export default mergeConfig(base, {
  define: { __STUDIO_DEMO_MODE__: 'true' },
})
