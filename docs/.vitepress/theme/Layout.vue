<script setup lang="ts">
import DefaultTheme from 'vitepress/theme'
import { ref } from 'vue'

const { Layout } = DefaultTheme
const command = 'npm i -g claude-code-extensions'
const copied = ref(false)

function copy() {
  navigator.clipboard.writeText(command).then(() => {
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  })
}
</script>

<template>
  <Layout>
    <template #home-hero-info-after>
      <div class="cx-install">
        <button class="cx-install-box" @click="copy" :aria-label="'Copy ' + command">
          <span class="cx-install-prompt">$</span>
          <code class="cx-install-cmd">{{ command }}</code>
          <span class="cx-install-copy">{{ copied ? 'copied' : 'copy' }}</span>
        </button>
      </div>
    </template>
  </Layout>
</template>

<style scoped>
.cx-install {
  margin-top: 28px;
  display: flex;
  justify-content: flex-start;
}

@media (max-width: 960px) {
  .cx-install {
    justify-content: center;
  }
}

.cx-install-box {
  display: inline-flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--vp-c-bg-alt);
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  font-family: var(--vp-font-family-mono);
  font-size: 14px;
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s;
}

.cx-install-box:hover {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-bg-soft);
}

.cx-install-prompt {
  color: var(--vp-c-brand-1);
  font-weight: 600;
  user-select: none;
}

.cx-install-cmd {
  color: var(--vp-c-text-1);
  background: transparent;
  padding: 0;
  font-size: 14px;
}

.cx-install-copy {
  color: var(--vp-c-text-3);
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding-left: 4px;
  border-left: 1px solid var(--vp-c-divider);
  margin-left: 4px;
}
</style>
