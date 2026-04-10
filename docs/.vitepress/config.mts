import { defineConfig } from 'vitepress'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: 'cx',
  description: 'Claude Code Extensions — modular, opt-in patches applied at runtime via AST transformation',
  cleanUrls: true,
  lastUpdated: true,

  themeConfig: {
    // https://vitepress.dev/reference/default-theme-config
    nav: [
      { text: 'Guide', link: '/guide/' },
      { text: 'Patches', link: '/patches' },
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
        text: 'Reference',
        items: [
          { text: 'Patches', link: '/patches' },
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
      copyright: 'Copyright © 2025-present Andrew Magid',
    },

    editLink: {
      pattern: 'https://github.com/magidandrew/cx/edit/main/docs/:path',
      text: 'Edit this page on GitHub',
    },
  },
})
