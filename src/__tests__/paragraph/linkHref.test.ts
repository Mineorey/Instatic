import { describe, it, expect } from 'bun:test'
import { isAllowedLinkHref, isExternalHref, normalizeLinkInput } from '@core/paragraph'

describe('isAllowedLinkHref', () => {
  it.each([
    'https://example.com', 'http://example.com/a?b#c', 'mailto:info@example.com', 'tel:+15550100',
    '/pricing', '#contact', '?q=1', 'cms:page:abc123', 'cms:page:abc123#top',
  ])('allows %s', (href) => expect(isAllowedLinkHref(href)).toBe(true))

  it.each([
    'javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)',
    'data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)', '//evil.example', 'pricing', '', '   ',
    'ftp://example.com', 'sms:123',
    '/\\evil.example', '/\\\\evil.example', '\\\\evil.example', '/\t/evil.example', '/\n/evil.example',
    'cms:page:',
  ])('rejects %p', (href) => expect(isAllowedLinkHref(href)).toBe(false))
})

describe('isExternalHref', () => {
  it('is true only for http(s)', () => {
    expect(isExternalHref('https://a.de')).toBe(true)
    expect(isExternalHref(' HTTPS://a.de')).toBe(true)
    expect(isExternalHref('/a')).toBe(false)
    expect(isExternalHref('cms:page:x')).toBe(false)
    expect(isExternalHref('mailto:a@b.de')).toBe(false)
  })
})

describe('normalizeLinkInput (acceptance finding C: https is added to bare hosts)', () => {
  it('prefixes https:// to a bare hostname, with or without path, query, fragment or port', () => {
    expect(normalizeLinkInput('www.example.com')).toBe('https://www.example.com')
    expect(normalizeLinkInput('example.com/careers')).toBe('https://example.com/careers')
    expect(normalizeLinkInput('example.com?x=1')).toBe('https://example.com?x=1')
    expect(normalizeLinkInput('example.com#top')).toBe('https://example.com#top')
    expect(normalizeLinkInput('www.example.com:8080/a')).toBe('https://www.example.com:8080/a')
    expect(normalizeLinkInput('sub-domain.example.co.uk')).toBe('https://sub-domain.example.co.uk')
    expect(normalizeLinkInput('muster-bau.example')).toBe('https://muster-bau.example')
    expect(normalizeLinkInput('192.168.0.10/x')).toBe('https://192.168.0.10/x')
  })

  it('trims surrounding whitespace', () => {
    expect(normalizeLinkInput('  www.x.de  ')).toBe('https://www.x.de')
    expect(normalizeLinkInput('  https://x.de ')).toBe('https://x.de')
    expect(normalizeLinkInput('   ')).toBe('')
  })

  it('never changes a value with an explicit scheme', () => {
    expect(normalizeLinkInput('http://example.com')).toBe('http://example.com')
    expect(normalizeLinkInput('https://example.com')).toBe('https://example.com')
    expect(normalizeLinkInput('mailto:info@example.com')).toBe('mailto:info@example.com')
    expect(normalizeLinkInput('tel:+15550100')).toBe('tel:+15550100')
    expect(normalizeLinkInput('cms:page:abc')).toBe('cms:page:abc')
  })

  it('leaves relative targets alone', () => {
    expect(normalizeLinkInput('/careers')).toBe('/careers')
    expect(normalizeLinkInput('/datei.pdf')).toBe('/datei.pdf')
    expect(normalizeLinkInput('#contact')).toBe('#contact')
    expect(normalizeLinkInput('?seite=2')).toBe('?seite=2')
  })

  it('leaves values that do not look like a hostname alone (validation rejects them)', () => {
    for (const raw of ['localhost', 'localhost:3000', 'careers', 'info@example.com', '3.14', 'a..b.de', '-x.de', 'x.d']) {
      expect(normalizeLinkInput(raw)).toBe(raw)
    }
    expect(isAllowedLinkHref(normalizeLinkInput('localhost'))).toBe(false)
    expect(isAllowedLinkHref(normalizeLinkInput('info@example.com'))).toBe(false)
  })

  it('never turns a script scheme into an allowed link', () => {
    for (const raw of ['javascript:alert(1)', ' JavaScript:alert(1)', 'data:text/html,x', 'vbscript:x', 'java.script:alert(1)']) {
      const value = normalizeLinkInput(raw)
      expect(value).toBe(raw.trim())
      expect(isAllowedLinkHref(value)).toBe(false)
    }
  })

  it('results pass isAllowedLinkHref', () => {
    for (const raw of ['www.example.com', 'example.com/careers', 'www.example.com:8080/a']) {
      expect(isAllowedLinkHref(normalizeLinkInput(raw))).toBe(true)
    }
  })
})

describe('normalizeLinkInput never turns a file name into a host (review C/F)', () => {
  it('leaves file names alone', () => {
    for (const raw of ['kontakt.html', 'index.php?id=3', 'datei.pdf', 'README.md', 'bild.jpeg#x', 'logo.svg', 'styles.css', 'app.js', 'data.json']) {
      expect(normalizeLinkInput(raw)).toBe(raw)
    }
  })

  it('still treats a file-extension-like TLD as a host with www. or a port', () => {
    expect(normalizeLinkInput('www.datei.pdf')).toBe('https://www.datei.pdf')
    expect(normalizeLinkInput('host.zip:8080')).toBe('https://host.zip:8080')
  })

  it('needs a letters-only TLD of 2 to 24 characters', () => {
    expect(normalizeLinkInput('example.museum')).toBe('https://example.museum')
    expect(normalizeLinkInput('example.abcdefghijklmnopqrstuvwxy')).toBe('example.abcdefghijklmnopqrstuvwxy')
    expect(normalizeLinkInput('example.d3')).toBe('example.d3')
  })
})

describe('normalizeLinkInput file-name rules, second pass (review)', () => {
  it('leaves more file names alone', () => {
    for (const ext of ['csv', 'avif', 'mov', 'ics', 'rtf', 'odt', 'ods', 'odp', 'webm', 'shtml', 'ogg', 'wav', 'tif', 'tiff', 'bmp', 'ico', '7z', 'rar', 'gz', 'tar', 'epub']) {
      expect(normalizeLinkInput(`datei.${ext}`)).toBe(`datei.${ext}`)
    }
  })

  it('a file name followed by a path is no host either', () => {
    expect(normalizeLinkInput('index.php/route')).toBe('index.php/route')
    expect(normalizeLinkInput('example.md/docs')).toBe('example.md/docs')
    expect(normalizeLinkInput('www.example.md/docs')).toBe('https://www.example.md/docs')
  })
})
