'use strict'

const { JSDOM } = require('jsdom')

// Shiki wraps its output in <pre ...><code>...</code></pre>; we re-wrap it ourselves.
// Match any attributes so this works for single and dual-theme output across Shiki versions.
const START_RX = /^\s*<pre\b[^>]*>\s*<code\b[^>]*>/i
const END_RX = /<\/code>\s*<\/pre>\s*$/i
const HIGHLIGHT_CLASS = 'highlighted'

class ShikiSyntaxHighlighter {
  static setContext (context) {
    ShikiSyntaxHighlighter.extensionContext = context
  }

  format (node, lang, opts = {}) {
    const logger = node.getLogger()

    logger.debug('Render source with shiki...')
    logger.debug(' > Source file: ' + node.document.reader.file)

    // Use the function with your XML string
    return moveConumsInsidePreviousLineSpan(node.getContent(), logger)
  }

  handlesHighlighting () {
    return true
  }

  highlight (node, source, lang, opts) {
    const { highlighter, config } = ShikiSyntaxHighlighter.extensionContext
    const logger = node.getLogger()

    const useLineNumbers = calculateLineNumbers(node, opts, config)
    const startNumber = opts.start_line_number || 1
    const dualThemes = calculateDualThemes(node, config)
    const theme = dualThemes ? dualThemes.light : calculateTheme(node, config.theme)
    const language = resolveLanguage(highlighter, lang, logger)

    logger.debug(' > Theme: ' + (dualThemes ? `light=${dualThemes.light}, dark=${dualThemes.dark}` : theme))
    logger.debug(' > Use line-numbers: ' + useLineNumbers)
    logger.debug(' > Use start-number: ' + startNumber)

    try {
      const options = {
        lang: language,
        transformers: [highlightLinesTransformer(getHighlightedLines(opts, logger))],
      }
      if (dualThemes) {
        // tokens get color:<light>;--shiki-dark:<dark>; shiki.css switches on html[data-theme="dark"] / html.dark
        options.themes = { light: dualThemes.light, dark: dualThemes.dark }
        options.defaultColor = 'light'
      } else {
        options.theme = theme
      }
      const generatedHtml = highlighter.codeToHtml(source, options)

      const colors = themeColors(highlighter, theme, config)
      const darkColors = dualThemes ? themeColors(highlighter, dualThemes.dark, config) : undefined

      //Leaving the html default results in nested pre/code elements,
      //which is rendered as an unattractive box around the highlighted code.
      const reducedHtml = removeGeneratedPreAndCodeTags(generatedHtml, logger)
      const themeClass = dualThemes ? `shiki-themes ${dualThemes.light} ${dualThemes.dark}` : theme
      return encloseInPreAndCodeTags(reducedHtml, themeClass, lang, useLineNumbers, startNumber, colors, darkColors)
    } catch (e) {
      logger.error(e.message, e)
      return escapeHtml(source)
    }
  }
}

// Background, foreground, line-number and conum colors for one theme
function themeColors (highlighter, theme, config) {
  const { bg, fg } = highlighter.getTheme(theme)
  return {
    background: bg,
    foreground: fg,
    lineNumber: calculateLineNumberColor(bg, config),
    conum: calculateConumColors(fg, config),
  }
}

// Fall back to plain text for languages that weren't loaded instead of failing the block
function resolveLanguage (highlighter, lang, logger) {
  if (!lang) return 'text'
  try {
    highlighter.getLanguage(lang)
    return lang
  } catch (e) {
    logger.warn(`Language '${lang}' is not loaded in shiki, rendering as plain text. Add it to the 'languages' option.`)
    return 'text'
  }
}

function highlightLinesTransformer (lines) {
  const highlighted = new Set(lines)
  return {
    name: 'antora-shiki-highlight-lines',
    line (hast, line) {
      if (highlighted.has(line)) this.addClassToHast(hast, HIGHLIGHT_CLASS)
    },
  }
}

function calculateConumColors (themeFg, config = {}) {
  // If both colors are configured, use them
  if (config.conumsBgColor && config.conumsFgColor) {
    return { background: config.conumsBgColor, foreground: config.conumsFgColor }
  }

  // By default, use a slightly dimmed version of the theme's foreground color
  const bgColor = config.conumsBgColor || adjustBrightness(themeFg, -15)

  // For dark backgrounds, use a light foreground and vice versa
  const fgColor = config.conumsFgColor || (brightness(bgColor) < 128 ? '#ffffff' : '#000000')

  return { background: bgColor, foreground: fgColor }
}

function encloseInPreAndCodeTags (html, themeClass, lang, useLineNumbers, startNumber, colors, darkColors) {
  const { config } = ShikiSyntaxHighlighter.extensionContext
  const lineNumberClass = useLineNumbers ? 'has-line-numbers' : ''

  let conumClasses = ''
  if (config.conumsOverride) {
    conumClasses = 'override-conums' + (config.conumsShowBorder ? ' with-conum-border' : '')
  }

  const preVars = colorVars('--shiki', colors, config) + (darkColors ? colorVars('--shiki-dark', darkColors, config) : '')
  const startAtLineNumberStyle = startNumber ? `--shiki-line-number-start: ${startNumber};` : ''
  const lineNumberColorStyle = colors.lineNumber ? ` --shiki-line-number-color: ${colors.lineNumber};` : ''
  const darkLineNumberColorStyle = darkColors && darkColors.lineNumber
    ? ` --shiki-dark-line-number-color: ${darkColors.lineNumber};`
    : ''
  const lineNumberStyle = `style="${startAtLineNumberStyle}${lineNumberColorStyle}${darkLineNumberColorStyle}"`

  return `<pre class="shiki highlight ${themeClass}" style="${preVars}"><code ${lang ? ` data-lang="${lang}"` : ''} class="shiki ${lineNumberClass} ${conumClasses}"${lineNumberStyle}>${html}</code></pre>`
}

// e.g. --shiki-background-color: #fff; --shiki-foreground-color: #000; (+ conum colors)
function colorVars (prefix, colors, config) {
  let vars = `${prefix}-background-color: ${colors.background}; ${prefix}-foreground-color: ${colors.foreground}; `
  if (config.conumsOverride) {
    vars += `${prefix}-conum-bg-color: ${colors.conum.background}; ${prefix}-conum-fg-color: ${colors.conum.foreground}; `
  }
  return vars
}

function removeGeneratedPreAndCodeTags (html, logger) {
  if (!START_RX.test(html) || !END_RX.test(html)) {
    logger.error(' > Unexpected shiki output, could not find the <pre><code> wrapper:\n' + html)
    return html
  }
  return html.replace(START_RX, '').replace(END_RX, '')
}

function getHighlightedLines (opts, logger) {
  let highlightedLines = []

  if (opts.number_lines && opts.highlight_lines) {
    logger.debug(' > highlight-lines: ' + opts.highlight_lines)
    highlightedLines = opts.highlight_lines.map((curLine) => {
      return {
        line: curLine,
        classes: [HIGHLIGHT_CLASS],
      }
    })
  }

  return highlightedLines
}

function calculateTheme (node, siteTheme) {
  if (node.hasAttribute('theme')) {
    return node.getAttribute('theme')
  }

  return node.document.getAttribute('shiki-theme') || siteTheme
}

function calculateDualThemes (node, config) {
  if (!config.lightTheme || !config.darkTheme) return undefined
  // An explicit theme on the block or page forces a single theme
  if (node.hasAttribute('theme') || node.document.getAttribute('shiki-theme')) return undefined
  return { light: config.lightTheme, dark: config.darkTheme }
}

function calculateLineNumbers (node, opts, config) {
  if (node.getAttribute('linenums') === 'nolinenums') {
    return false
  }

  const siteLevelLineNumbers = config.useLineNumbers || false
  const pageLevelLineNumbers = node.document.getAttribute('shiki-line-numbers')
  const blockLevelLineNumbers = opts.number_lines ? !!opts.number_lines : undefined

  return toBoolean(blockLevelLineNumbers ?? pageLevelLineNumbers ?? siteLevelLineNumbers)
}

function calculateLineNumberColor (backgroundColor, config = {}) {
  // Allow override from config
  if (config.lineNumberColor) return config.lineNumberColor
  return brightness(backgroundColor) < 128 ? adjustBrightness(backgroundColor, 200) : adjustBrightness(backgroundColor, -100)
}

function brightness (hex) {
  const r = parseInt(hex.substr(1, 2), 16)
  const g = parseInt(hex.substr(3, 2), 16)
  const b = parseInt(hex.substr(5, 2), 16)
  return (r * 299 + g * 587 + b * 114) / 1000
}

function adjustBrightness (hex, percent) {
  let r = parseInt(hex.substr(1, 2), 16)
  let g = parseInt(hex.substr(3, 2), 16)
  let b = parseInt(hex.substr(5, 2), 16)

  r = parseInt(r * (100 + percent) / 100, 10)
  g = parseInt(g * (100 + percent) / 100, 10)
  b = parseInt(b * (100 + percent) / 100, 10)

  r = (r < 255) ? r : 255
  g = (g < 255) ? g : 255
  b = (b < 255) ? b : 255

  const rr = (r.toString(16).length === 1) ? '0' + r.toString(16) : r.toString(16)
  const gg = (g.toString(16).length === 1) ? '0' + g.toString(16) : g.toString(16)
  const bb = (b.toString(16).length === 1) ? '0' + b.toString(16) : b.toString(16)

  return '#' + rr + gg + bb
}

function moveConumsInsidePreviousLineSpan (xmlString, logger) {
  const dom = new JSDOM(xmlString)
  const document = dom.window.document

  document.querySelectorAll('i.conum').forEach((icon) => {
    const prevSpan = icon.previousElementSibling
    if (prevSpan && prevSpan.tagName === 'SPAN') {
      const bold = icon.nextSibling.tagName === 'B' ? icon.nextSibling : null
      prevSpan.appendChild(icon)
      if (bold) {
        prevSpan.appendChild(bold)
      }
    }
  })

  return dom.serialize()
}

function escapeHtml (text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function toBoolean (value) {
  if (typeof value === 'string') {
    return value.toLowerCase().trim() === 'true'
  }
  return !!value // Convert to boolean if not a string
}

module.exports = ShikiSyntaxHighlighter
