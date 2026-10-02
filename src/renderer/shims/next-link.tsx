import { forwardRef, type AnchorHTMLAttributes } from "react"
import { Link } from "react-router-dom"
import { resolveHref } from "./paths"

type UrlObject = { pathname?: string; query?: Record<string, string>; hash?: string }

type NextLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: string | UrlObject
  replace?: boolean
  prefetch?: boolean | null
  scroll?: boolean
  shallow?: boolean
  passHref?: boolean
  legacyBehavior?: boolean
}

function hrefToString(href: string | UrlObject): string {
  if (typeof href === "string") return href
  const query = href.query ? `?${new URLSearchParams(href.query).toString()}` : ""
  return `${href.pathname ?? ""}${query}${href.hash ?? ""}`
}

/** `next/link` for the desktop renderer, backed by React Router. */
const NextLink = forwardRef<HTMLAnchorElement, NextLinkProps>(function NextLink(
  { href, replace, prefetch: _prefetch, scroll: _scroll, shallow: _shallow, passHref: _passHref, legacyBehavior: _legacy, ...rest },
  ref,
) {
  const target = resolveHref(hrefToString(href))
  if (target.kind === "external") {
    return <a ref={ref} href={target.url} target="_blank" rel="noreferrer" {...rest} />
  }
  return <Link ref={ref} to={target.path} replace={replace} {...rest} />
})

export default NextLink
