import { createApp } from 'vue'
import { createI18n } from 'vue-i18n'
import './styles/tokens.css'
import './style.css'
import '@dns-modules/base-link/style.css'
import '@dns-modules/base-ui-button/style.css'
import '@dns-modules/base-ui-tabs/style.css'
import '@dns-modules/bottom-sheet/style.css'
import '@dns-modules/checkbox/style.css'
import '@dns-modules/font-icon/font-icon.scss'
import '@dns-modules/list-row/style.css'
import '@dns-modules/menu/style.css'
import '@dns-modules/modal/style.css'
import '@dns-modules/popover/style.css'
import '@dns-modules/select-inline/style.css'
import '@dns-modules/snackbar/style.css'
import '@dns-modules/stepper/style.css'
import '@dns-modules/toggle/style.css'
import './figma-alignment.css'
import App from './App.vue'

const i18n = createI18n({
  legacy: false,
  locale: 'ru',
  fallbackLocale: 'ru',
  messages: { ru: {} },
})

createApp(App).use(i18n).mount('#app')
