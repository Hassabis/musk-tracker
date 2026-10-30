import { createRoot } from 'react-dom/client'
import App from './App'
import './style.css'
import './theme.css'
import { detectLocale, LocaleProvider } from './i18n'
import type { Locale } from './i18n/locale'
const root = createRoot(document.getElementById('app')!)
let language:Locale | null = null
function render(Component:typeof App){
  if(language)root.render(<LocaleProvider initialLocale={language}><Component/></LocaleProvider>)
}
void detectLocale().then(value=>{language=value;render(App)})
// Vite's native HMR also works without the network-installed React plugin.
if (import.meta.hot) import.meta.hot.accept('./App', module => {
  if (module) render(module.default)
})
