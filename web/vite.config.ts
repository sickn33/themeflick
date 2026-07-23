import { cloudflare } from '@cloudflare/vite-plugin'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

import { sites } from './build/sites-vite-plugin'
import hosting from './.openai/hosting.json'

export default defineConfig(({ mode }) => ({
  plugins:
    mode === 'test'
      ? [react()]
      : [
          react(),
          sites(),
          cloudflare({
            config: (config) => ({
              ...config,
              d1_databases: hosting.d1
                ? [
                    {
                      binding: hosting.d1,
                      database_name: 'site-creator-d1',
                      database_id: '00000000-0000-4000-8000-000000000000',
                    },
                  ]
                : [],
            }),
          }),
        ],
}))
