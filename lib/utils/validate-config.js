const defaultTheme = 'nord'
const defaultLanguages = ['asciidoc', 'java', 'js', 'shell', 'bash', 'console', 'zsh', 'yaml', 'xml', 'diff']
const defaultUseLineNumbers = false

function validateConfig (config, packageName, logger) {
  const {
    theme: configuredTheme,
    lightTheme,
    darkTheme,
    themes = [],
    languages = defaultLanguages,
    useLineNumbers = defaultUseLineNumbers,
    registerLanguages = [],
    conumsOverride = false,
    conumsBgColor,
    conumsFgColor,
    conumsShowBorder = false,
    ...unknownOptions
  } = config

  if (Object.keys(unknownOptions).length) {
    const unrecognizedOptions = Object.keys(unknownOptions).join(', ')
    throw new Error(`Unrecognized options specified for ${packageName}: ${unrecognizedOptions}`)
  }

  if (!!lightTheme !== !!darkTheme) {
    throw new Error(`${packageName}: light_theme and dark_theme must be set together`)
  }
  // With light/dark themes and no explicit theme, the light theme is the default single theme
  const theme = configuredTheme || lightTheme || defaultTheme

  let newThemes = themes
  if (newThemes.length > 0) {
    newThemes.unshift(theme)
    newThemes = themes.filter((value, index, self) => self.indexOf(value) === index)
  }

  const validatedConfig = {
    theme,
    lightTheme,
    darkTheme,
    themes: newThemes,
    languages,
    useLineNumbers,
    registerLanguages,
    conumsOverride,
    conumsBgColor,
    conumsFgColor,
    conumsShowBorder,
  }

  logger.info(`Registering ${packageName} with config`)
  logger.info(` > Default Theme: ${validatedConfig.theme}`)
  if (lightTheme) logger.info(` > Light/dark themes: ${lightTheme} / ${darkTheme}`)
  logger.info(` > Themes to load: ${Array.from(validatedConfig.themes).join(', ')}`)
  logger.info(` > Supported languages: ${Array.from(validatedConfig.languages).sort().join(', ')}`)
  logger.info(` > Use line numbers: ${validatedConfig.useLineNumbers}`)
  if (validatedConfig.conumsOverride) {
    logger.info(` > Override conums: true`)
    logger.info(` > Conum colors: bg=${validatedConfig.conumsBgColor || 'default'}, fg=${validatedConfig.conumsFgColor || 'default'}`)
    if (validatedConfig.conumsShowBorder) logger.info(` > Conum border: enabled`)
  }

  return validatedConfig
}

module.exports = validateConfig
