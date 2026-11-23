const fs = require('fs')
const ospath = require('path')

// Async function to create a syntax highlighter using the Shiki library
async function createHighlighter ({ logger, config, playbook }) {
  logger.info('Creating shiki highlighter ...')
  // shiki is ESM-only since v1, so load it with a dynamic import from this CommonJS module
  const shiki = await import('shiki')
  logger.info(' > Instantiate shiki highlighter')

  // Check for the presence of 'asciidoc' in the languages configuration
  const asciidocIncluded = config.languages.includes('asciidoc')

  // Filter out 'asciidoc' from the list of languages (it is registered from the bundled grammar)
  const langs = config.languages.filter((lang) => lang !== 'asciidoc')
  const registerLanguages = config.registerLanguages

  if (registerLanguages.length > 0 || asciidocIncluded) {
    logger.info(' > Register custom language grammar:')
  }

  if (asciidocIncluded) {
    const asciidocGrammarPath = ospath.join(__dirname, '../../data/languages/Asciidoctor.json')
    logger.info(`   > asciidoc -> ${asciidocGrammarPath}`)
    langs.push(toLanguageRegistration(asciidocGrammarPath, { id: 'asciidoc', scopeName: 'text.asciidoc', aliases: ['adoc'] }))
  }

  for (const language of registerLanguages) {
    const grammarPath = ospath.join(playbook.dir, language.grammarPath)
    logger.info(`   > ${language.id} -> ${grammarPath}`)
    langs.push(toLanguageRegistration(grammarPath, language))
  }

  return await shiki.createHighlighter({ langs, themes: themesToLoad(config) })
}

// Shiki >= 1 expects the grammar itself, extended with the language name/aliases
function toLanguageRegistration (grammarPath, { id, scopeName, aliases = [] }) {
  const grammar = JSON.parse(fs.readFileSync(grammarPath, 'utf8'))
  return {
    ...grammar,
    name: id,
    scopeName: scopeName || grammar.scopeName,
    aliases: [...new Set([...(grammar.aliases || []), ...aliases])],
  }
}

function themesToLoad (config) {
  return [...new Set([config.theme, ...config.themes, config.lightTheme, config.darkTheme].filter(Boolean))]
}

module.exports = { createHighlighter, themesToLoad }
