// ESLint recommended rules for the project's own code (npm run lint)
const js = require('@eslint/js');
const globals = require('globals');

module.exports = [
    // CoreUI files (see THIRD_PARTY_NOTICES.md) and installed packages are not checked
    { ignores: ['node_modules/**', 'public/vendors/**', 'public/css/**', 'coverage/**'] },
    js.configs.recommended,
    {
        files: ['**/*.js'],
        languageOptions: { ecmaVersion: 2023, sourceType: 'commonjs', globals: { ...globals.node } }
    },
    {
        // runs in the browser, after the CoreUI bundle (global "coreui")
        files: ['public/js/**/*.js'],
        languageOptions: { sourceType: 'script', globals: { ...globals.browser, coreui: 'readonly' } }
    }
];
