import { urlScheme } from '@core/html-sanitize'
import { parsePageRef } from '@core/page-tree'

const ALLOWED_SCHEMES = new Set(['http:', 'https:', 'mailto:', 'tel:'])

/** Link targets the paragraph editor accepts (spec §3.3). Publish still runs safeUrl(). */
export function isAllowedLinkHref(raw: string): boolean {
  const value = raw.trim()
  if (!value) return false

  // Check for internal page reference
  const pageRef = parsePageRef(value)
  if (pageRef && pageRef.pageId) return true

  const scheme = urlScheme(value)
  if (scheme === null) {
    // Reject protocol-relative URLs and their disguises:
    // - `//evil.example` (obvious)
    // - `/\evil.example` (backslash bypass, normalized to `//` by browser)
    // - `/\t/evil.example` (tab bypass)
    // - `\evil.example` (backslash prefix)
    const normalized = value.replace(/[\t\n\r]/g, '')
    if (/^[/\\]{2}/.test(normalized) || normalized.includes('\\')) return false

    return /^[/#?]/.test(value)
  }
  return ALLOWED_SCHEMES.has(scheme)
}

export function isExternalHref(raw: string): boolean {
  const scheme = urlScheme(raw.trim())
  return scheme === 'http:' || scheme === 'https:'
}

const LABEL = String.raw`[\p{L}\p{N}](?:[\p{L}\p{N}-]*[\p{L}\p{N}])?`
/**
 * A bare host at the start of the input: dotted labels ending in a letters-only
 * TLD of 2–24 characters (or an IPv4 address), an optional port, then the end
 * or a path / query / fragment. Groups: 1 = TLD, 2 = port.
 */
const BARE_HOST = new RegExp(
  String.raw`^(?:(?:${LABEL}\.)+(\p{L}{2,24})|\d{1,3}(?:\.\d{1,3}){3})(:\d{1,5})?(?:[/?#]|$)`,
  'u',
)

/**
 * Endings that make `kontakt.html`, `index.php?id=3` or `index.php/route` a
 * file name, not a host. Such a value only counts as a host with `www.` or a
 * port.
 */
const FILE_EXTENSIONS = new Set([
  'html', 'htm', 'php', 'asp', 'aspx', 'jsp', 'pdf', 'jpg', 'jpeg', 'png', 'gif', 'svg', 'webp',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'zip', 'txt', 'md', 'json', 'xml', 'css', 'js', 'mp4', 'mp3',
  'csv', 'avif', 'mov', 'ics', 'rtf', 'odt', 'ods', 'odp', 'webm', 'shtml', 'ogg', 'wav', 'tif', 'tiff', 'bmp',
  'ico', '7z', 'rar', 'gz', 'tar', 'epub',
])

function isBareHost(value: string): boolean {
  const match = BARE_HOST.exec(value)
  if (!match) return false
  const [, tld, port] = match
  if (!tld || !FILE_EXTENSIONS.has(tld.toLowerCase())) return true
  return /^www\./i.test(value) || port !== undefined
}

/**
 * What the link panel stores for a typed URL: trimmed, and `https://` added
 * when the value starts with a bare hostname (`www.example.com`,
 * `example.com/careers`, `host.de:8080`). Everything else is returned trimmed
 * and unchanged — explicit schemes (`http://` stays http, `mailto:`, `tel:`,
 * `javascript:` …), relative targets (`/`, `#`, `?`) and anything that is no
 * dotted hostname (`localhost`, `info@x.de`) or reads as a file name
 * (`kontakt.html`, `datei.pdf`). The result still has to pass
 * `isAllowedLinkHref`.
 */
export function normalizeLinkInput(raw: string): string {
  const value = raw.trim()
  return isBareHost(value) ? `https://${value}` : value
}
