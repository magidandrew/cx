import { defineConfig } from 'vitepress'

const SITE_URL = 'https://cx.worms.coffee'
const SITE_NAME = 'cx — Claude Code Extensions'
const SITE_DESCRIPTION =
  'cx is a modular, opt-in patch system for Anthropic\'s Claude Code CLI. Apply runtime AST patches — message queue, persistent max effort, no attribution, hot reload, session usage, and more — without ever modifying the upstream claude binary.'

// https://vitepress.dev/reference/site-config
export default defineConfig({
  title: 'cx',
  titleTemplate: ':title | cx — Claude Code Extensions',
  description: SITE_DESCRIPTION,
  cleanUrls: true,
  lastUpdated: true,
  srcExclude: ['**/CLAUDE.md'],

  sitemap: {
    hostname: SITE_URL,
  },

  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/cx-logo.svg' }],
    ['meta', { name: 'author', content: 'Andrew Magid' }],
    ['meta', {
      name: 'keywords',
      content:
        'claude code, claude code cli, claude code extensions, claude code patches, anthropic claude code, claude code plugins, claude code customization, claude code tweaks, cx, claude-code-extensions',
    }],
    ['meta', { name: 'theme-color', content: '#000000' }],
    ['meta', { property: 'og:site_name', content: 'cx — Claude Code Extensions' }],
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'cx — Claude Code Extensions' }],
    ['meta', {
      property: 'og:description',
      content: 'Modular, opt-in patches for Claude Code. Unlock the power of Claude Code, without compromise.',
    }],
    ['meta', { property: 'og:image', content: `${SITE_URL}/og-image.png` }],
    ['meta', { property: 'og:image:alt', content: 'cx — Claude Code Extensions' }],
    ['meta', { property: 'og:url', content: `${SITE_URL}/` }],
    ['meta', { name: 'twitter:card', content: 'summary_large_image' }],
    ['meta', { name: 'twitter:title', content: 'cx — Claude Code Extensions' }],
    ['meta', {
      name: 'twitter:description',
      content: 'Modular, opt-in patches for Claude Code. Unlock the power of Claude Code, without compromise.',
    }],
    ['meta', { name: 'twitter:image', content: `${SITE_URL}/og-image.png` }],
  ],

  transformPageData(pageData) {
    const cleanPath = pageData.relativePath
      .replace(/(^|\/)index\.md$/, '$1')
      .replace(/\.md$/, '')
    const canonical = `${SITE_URL}/${cleanPath}`

    pageData.frontmatter.head ??= []

    pageData.frontmatter.head.push([
      'link',
      { rel: 'canonical', href: canonical },
    ])
    pageData.frontmatter.head.push([
      'meta',
      { property: 'og:url', content: canonical },
    ])

    const pageDescription =
      pageData.frontmatter.description || pageData.description || SITE_DESCRIPTION
    pageData.frontmatter.head.push([
      'meta',
      { property: 'og:description', content: pageDescription },
    ])
    pageData.frontmatter.head.push([
      'meta',
      { name: 'twitter:description', content: pageDescription },
    ])

    if (pageData.relativePath === 'index.md') {
      pageData.frontmatter.head.push([
        'script',
        { type: 'application/ld+json' },
        JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'SoftwareApplication',
          name: 'cx — Claude Code Extensions',
          alternateName: ['cx', 'claude-code-extensions'],
          description: SITE_DESCRIPTION,
          applicationCategory: 'DeveloperApplication',
          operatingSystem: 'macOS, Linux, Windows',
          url: SITE_URL,
          downloadUrl: 'https://www.npmjs.com/package/claude-code-extensions',
          license: 'https://opensource.org/licenses/MIT',
          author: {
            '@type': 'Person',
            name: 'Andrew Magid',
            url: 'https://github.com/magidandrew',
          },
          codeRepository: 'https://github.com/magidandrew/cx',
          programmingLanguage: 'TypeScript',
          offers: {
            '@type': 'Offer',
            price: '0',
            priceCurrency: 'USD',
          },
        }),
      ])
      pageData.frontmatter.head.push([
        'script',
        { type: 'application/ld+json' },
        JSON.stringify({
          '@context': 'https://schema.org',
          '@type': 'WebSite',
          name: SITE_NAME,
          url: SITE_URL,
        }),
      ])
    }
  },

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
              { text: 'Show File in Collapsed Read', link: '/patches/show-file-in-collapsed-read' },
              { text: 'Disable Paste Collapse', link: '/patches/disable-paste-collapse' },
              { text: 'Disable Long-Text Truncation', link: '/patches/disable-text-truncation' },
              { text: 'Persist Max Effort', link: '/patches/persist-max-effort' },
              { text: 'Per-Session Effort', link: '/patches/per-session-effort' },
              { text: 'Ctrl+X Ctrl+R Reload', link: '/patches/reload' },
              { text: 'No Tips', link: '/patches/no-tips' },
              { text: 'No Feedback Prompts', link: '/patches/no-feedback' },
              { text: 'No NPM Warning', link: '/patches/no-npm-warning' },
              { text: 'No Multi-Install Warning', link: '/patches/no-multi-install-warning' },
              { text: 'No Attribution', link: '/patches/no-attribution' },
              { text: 'Disable Telemetry', link: '/patches/disable-telemetry' },
              { text: 'Random Clawd Color', link: '/patches/random-clawd' },
              { text: 'CX Badge', link: '/patches/cx-badge' },
              { text: 'Anthropic Status Banner', link: '/patches/anthropic-status-banner' },
              { text: 'cx Resume Commands', link: '/patches/cx-resume-commands' },
              { text: 'Auto /rename on First Message', link: '/patches/auto-rename-first-message' },
              { text: '/cd Command', link: '/patches/cd-command' },
              { text: 'Attribution Banner', link: '/patches/banner' },
              { text: 'Auto-Detect Terminal Theme', link: '/patches/auto-detect-theme' },
              { text: 'Delete Sessions from /resume', link: '/patches/delete-sessions' },
              { text: 'Swap Enter / Meta+Enter', link: '/patches/swap-enter-submit' },
              { text: 'Cut prompt to clipboard', link: '/patches/cut-to-clipboard' },
              { text: 'Simple Spinner', link: '/patches/simple-spinner' },
              { text: 'NSFW Spinner', link: '/patches/nsfw-spinner' },
              { text: 'Granular Effort Slider', link: '/patches/granular-effort' },
              { text: 'Session Usage', link: '/patches/session-usage' },
              { text: 'Random Color on /rename', link: '/patches/rename-random-color' },
              { text: 'Remote Control on by Default', link: '/patches/remote-control-default-on' },
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
