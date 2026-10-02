import { routesFromGlob } from "./host"

/**
 * The API route modules (src/portal/app/api), bundled into the main process.
 */
export const routes = routesFromGlob(
  import.meta.glob("../../portal/app/api/**/route.ts", { eager: true }),
)
