/* global __APP_VERSION__ */

/**
 * Versao exibida no rodape da sidebar (usuario e admin).
 *
 * O valor e injetado no bundle pelo vite.config.js, que resolve nesta ordem:
 * variavel de ambiente APP_VERSION -> src/version.json (gerado por
 * scripts/set-version.mjs no prebuild) -> numero de commits do git ->
 * package.json. Com isso o contador volta a andar a cada release, em vez de
 * ficar travado num literal dentro de cada layout.
 */
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : '1.0.0';
export const APP_VERSION_LABEL = `v${APP_VERSION}`;
