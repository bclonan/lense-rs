import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
export default defineConfig({ plugins: [vue()], server:{watch:{ignored:['**/bridge/target/**','**/.pnpm-store/**','**/artifacts/**','**/test-results/**']}}, build: { target: 'es2022' } })
