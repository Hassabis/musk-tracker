import { useI18n } from '../i18n'
import { Select } from './Select'
import type { Tracking } from '../lib/types'
import { marketPhase } from '../lib/markets'

export function MarketPicker({markets,value,onChange,className=''}:{markets:Tracking[];value:string;onChange:(id:string)=>void;className?:string}) {
  const {t:tr,locale}=useI18n()

  const date = (value:string) => new Intl.DateTimeFormat(locale,{timeZone:'America/New_York',month:'short',day:'numeric'}).format(new Date(value))
  return <Select className={className} label={tr("选择市场周期")} value={value} onChange={onChange} searchable menuWidth={320}
    options={markets.map(t=>({value:t.id,label:`${new Date(t.startDate).getFullYear()!==new Date().getFullYear()?new Date(t.startDate).getFullYear()+tr("年 · "):''}${date(t.startDate)} — ${date(t.endDate)}`,searchText:t.title+' '+t.startDate.slice(0,10)+' '+t.endDate.slice(0,10),group:[tr("进行中"),tr("即将开始"),tr("已结束")][marketPhase(t)]}))}/>
}
