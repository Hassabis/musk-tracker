import { useI18n } from '../i18n'
import { isLocale, localeNames, locales } from '../i18n/locale'
import { Select } from './Select'
export function LanguagePicker(){
  const {language,setLanguage,t}=useI18n()
  return <Select className="language-picker" label={t('语言')} value={language} onChange={value=>{if(isLocale(value))setLanguage(value)}} options={locales.map(value=>({value,label:localeNames[value]}))}/>
}
