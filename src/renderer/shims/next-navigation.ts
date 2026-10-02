import { useMemo } from "react"
import {
  useLocation,
  useNavigate,
  useParams as useRouterParams,
  useSearchParams as useRouterSearchParams,
} from "react-router-dom"
import { openExternal, resolveHref } from "./paths"

/** `next/navigation` for the desktop renderer, backed by React Router. */

function go(navigate: ReturnType<typeof useNavigate>, href: string, replace: boolean): void {
  const target = resolveHref(href)
  if (target.kind === "external") openExternal(target.url)
  else void navigate(target.path, { replace })
}

export function useRouter() {
  const navigate = useNavigate()
  return useMemo(
    () => ({
      push: (href: string) => go(navigate, href, false),
      replace: (href: string) => go(navigate, href, true),
      back: () => void navigate(-1),
      forward: () => void navigate(1),
      // There are no server components to refetch in the desktop app.
      refresh: () => undefined,
      prefetch: () => undefined,
    }),
    [navigate],
  )
}

export function usePathname(): string {
  return useLocation().pathname
}

export function useSearchParams(): URLSearchParams {
  return useRouterSearchParams()[0]
}

export function useParams<T extends Record<string, string>>(): T {
  return useRouterParams() as T
}

export function redirect(href: string): never {
  const target = resolveHref(href)
  if (target.kind === "external") openExternal(target.url)
  else window.location.hash = target.path
  throw new Error(`Redirected to ${href}`)
}

export function notFound(): never {
  window.location.hash = "/portal/dashboard"
  throw new Error("Not found")
}
