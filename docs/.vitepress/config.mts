import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: 'cx',
  description: 'Claude Code Extensions — modular, opt-in patches applied at runtime via AST transformation',
  cleanUrls: true,
  lastUpdated: true,
  srcExclude: ['**/CLAUDE.md'],

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/cx-logo.svg' }],
  ],

  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    logo: '/cx-logo.svg',

    nav: [
      { text: 'Guide', link: '/guide/' },
      { text: 'Patches', link: '/patches/' },
      { text: 'npm', link: 'https://www.npmjs.com/package/claude-code-extensions' },
    ],

    sidebar: [
      {
        text: 'Introduction',
        items: [
          { text: 'What is cx?', link: '/guide/' },
          { text: 'Installation', link: '/guide/installation' },
          { text: 'How it works', link: '/guide/how-it-works' },
        ],
      },
      {
        text: 'Patches',
        items: [
          { text: 'All patches', link: '/patches/' },
          {
            text: 'Patches Reference',
            collapsed: true,
            items: [
              { text: 'Ctrl+Q Message Queue', link: '/patches/queue' },
              { text: 'Always Show Thinking', link: '/patches/always-show-thinking' },
              { text: 'Always Show Context', link: '/patches/always-show-context' },
              { text: 'Show File in Collapsed Read', link: '/patches/show-file-in-collapsed-read' },
              { text: 'Disable Paste Collapse', link: '/patches/disable-paste-collapse' },
              { text: 'Disable Long-Text Truncation', link: '/patches/disable-text-truncation' },
              { text: 'Persist Max Effort', link: '/patches/persist-max-effort' },
              { text: 'Ctrl+X Ctrl+R Reload', link: '/patches/reload' },
              { text: 'No Tips', link: '/patches/no-tips' },
              { text: 'No Feedback Prompts', link: '/patches/no-feedback' },
              { text: 'No NPM Warning', link: '/patches/no-npm-warning' },
              { text: 'No Attribution', link: '/patches/no-attribution' },
              { text: 'Disable Telemetry', link: '/patches/disable-telemetry' },
              { text: 'Random Clawd Color', link: '/patches/random-clawd' },
              { text: 'CX Badge', link: '/patches/cx-badge' },
              { text: 'cx Resume Commands', link: '/patches/cx-resume-commands' },
              { text: '/cd Command', link: '/patches/cd-command' },
              { text: 'Attribution Banner', link: '/patches/banner' },
              { text: 'Swap Enter / Meta+Enter', link: '/patches/swap-enter-submit' },
              { text: 'Cut prompt to clipboard', link: '/patches/cut-to-clipboard' },
              { text: 'Simple Spinner', link: '/patches/simple-spinner' },
              { text: 'Granular Effort Slider', link: '/patches/granular-effort' },
              { text: 'Session Usage', link: '/patches/session-usage' },
            ],
          },
        ],
      },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/magidandrew/cx' },
    ],

    search: {
      provider: 'local',
    },

    footer: {
      message: 'Released under the MIT License.',
    },

    editLink: {
      pattern: 'https://github.com/magidandrew/cx/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },
  },
})
