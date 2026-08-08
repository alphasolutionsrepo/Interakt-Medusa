import { loadEnv, defineConfig } from '@medusajs/framework/utils'

loadEnv(process.env.NODE_ENV || 'development', process.cwd())

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET,
      cookieSecret: process.env.COOKIE_SECRET,
    }
  },
  modules: [
    {
      // Interakt search index. Values come from .env rather than being written
      // here — this file is tracked by git, .env is not.
      resolve: './src/modules/search-index',
      options: {
        baseUrl: process.env.SEARCH_INDEX_URL ?? 'http://localhost:3000',
        indexId: process.env.SEARCH_INDEX_ID,
        apiKey: process.env.SEARCH_INDEX_API_KEY,
        currency: process.env.SEARCH_INDEX_CURRENCY ?? 'usd',
      },
    },
  ],
})

