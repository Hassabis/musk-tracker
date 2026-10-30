import { useI18n } from '../i18n'
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { Icon } from './Icon'

export type SelectOption = { value: string; label: string; group?: string; searchText?: string }
type Props = {
  label: string; value: string; onChange: (value: string) => void; options: SelectOption[]
  icon?: ReactNode; searchable?: boolean; className?: string; menuWidth?: number
}
export function Select({label,value,onChange,options,icon,searchable=false,className='',menuWidth}:Props) {
  const {t:tr}=useI18n()

  const id=useId()
  const trigger=useRef<HTMLButtonElement>(null)
  const popup=useRef<HTMLDivElement>(null)
  const searchInput=useRef<HTMLInputElement>(null)
  const list=useRef<HTMLDivElement>(null)
  const [open,setOpen]=useState(false)
  const [query,setQuery]=useState('')
  const [active,setActive]=useState(0)
  const [placement,setPlacement]=useState({left:0,top:0,width:200,maxHeight:320,up:false})
  const reduce=useReducedMotion()??false
  const selected=options.find(option=>option.value===value)
  const filtered=useMemo(()=>options.filter(option=>`${option.label} ${option.searchText||''}`.toLowerCase().includes(query.trim().toLowerCase())),[options,query])
  const groups=useMemo(()=>Array.from(new Set(filtered.map(option=>option.group||''))),[filtered])
  const listId=`${id}-list`
  function show(){setQuery('');setActive(Math.max(0,options.findIndex(option=>option.value===value)));setOpen(true)}
  function close(restoreFocus=false){setOpen(false);if(restoreFocus)trigger.current?.focus()}
  function choose(option:SelectOption){onChange(option.value);close(true)}
  useLayoutEffect(()=>{
    if(!open)return
    const position=()=>{
      const rect=trigger.current!.getBoundingClientRect()
      const width=Math.min(menuWidth||Math.max(rect.width,180),window.innerWidth-24)
      const desired=Math.min(368,Math.max(74,filtered.length*38+groups.length*28+(searchable?52:10)))
      const below=window.innerHeight-rect.bottom-12,above=rect.top-12
      const up=below<desired&&above>below
      const maxHeight=Math.max(80,Math.min(desired,up?above:below))
      setPlacement({left:Math.max(12,Math.min(rect.left,window.innerWidth-width-12)),top:up?rect.top-6:rect.bottom+6,width,maxHeight,up})
    }
    position()
    const onScroll=(e:Event)=>{if(!popup.current?.contains(e.target as Node))position()}
    window.addEventListener('resize',position)
    window.addEventListener('scroll',onScroll,true)
    return()=>{window.removeEventListener('resize',position);window.removeEventListener('scroll',onScroll,true)}
  },[open,filtered.length,groups.length,searchable,menuWidth])
  useEffect(()=>{
    if(!open)return
    if(searchable)searchInput.current?.focus();else list.current?.focus()
    const onOutside=(event:PointerEvent)=>{if(!trigger.current?.contains(event.target as Node)&&!popup.current?.contains(event.target as Node))setOpen(false)}
    document.addEventListener('pointerdown',onOutside)
    return()=>document.removeEventListener('pointerdown',onOutside)
  },[open,searchable])
  useEffect(()=>{
    if(!open)return
    list.current?.querySelector(`[data-option-index="${active}"]`)?.scrollIntoView({block:'nearest'})
  },[active,open])
  function onKeyDown(event:KeyboardEvent){
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();close(true);return}
    if(event.key==='Tab'){close();return}
    if(!filtered.length)return
    if(event.key==='ArrowDown'){event.preventDefault();setActive(i=>(i+1)%filtered.length)}
    else if(event.key==='ArrowUp'){event.preventDefault();setActive(i=>(i-1+filtered.length)%filtered.length)}
    else if(event.key==='Home'&&event.target!==searchInput.current){event.preventDefault();setActive(0)}
    else if(event.key==='End'&&event.target!==searchInput.current){event.preventDefault();setActive(filtered.length-1)}
    else if(event.key==='Enter'){event.preventDefault();if(filtered[active])choose(filtered[active])}
  }
  return <>
    <button ref={trigger} type="button" className={`custom-select ${className} ${open?'is-open':''}`} aria-label={label} aria-haspopup="listbox" aria-expanded={open} aria-controls={open?listId:undefined} onClick={()=>open?close():show()} onKeyDown={event=>{if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();show()}}} title={selected?.label}>
      {icon}<span className="custom-select-value">{selected?.label||tr("请选择")}</span><Icon name="down" size={13} className="select-chevron"/>
    </button>
    {createPortal(<AnimatePresence>{open&&<div className="select-positioner" style={{left:placement.left,top:placement.top,width:placement.width,transform:placement.up?'translateY(-100%)':undefined}}>
      <motion.div ref={popup} className="select-popup" style={{maxHeight:placement.maxHeight,transformOrigin:placement.up?'bottom':'top'}} initial={reduce?false:{opacity:0,y:placement.up?4:-4,scale:.985}} animate={{opacity:1,y:0,scale:1}} exit={{opacity:0,y:placement.up?4:-4}} transition={{duration:reduce?0:.14,ease:[.16,1,.3,1]}} onKeyDown={onKeyDown}>
        {searchable&&<div className="select-search"><Icon name="search" size={15}/><input ref={searchInput} role="combobox" aria-label={tr("搜索市场周期")} aria-autocomplete="list" aria-expanded="true" aria-controls={listId} aria-activedescendant={filtered[active]?`${id}-option-${active}`:undefined} value={query} onChange={event=>{setQuery(event.target.value);setActive(0)}} placeholder={tr("搜索市场或日期")} autoComplete="off"/><kbd>esc</kbd></div>}
        <div ref={list} id={listId} className="select-options" role="listbox" aria-label={label} tabIndex={searchable?undefined:-1} aria-activedescendant={filtered[active]?`${id}-option-${active}`:undefined}>
          {!filtered.length&&<div className="select-no-results">{tr("没有匹配的市场")}</div>}
          {groups.map(group=><div key={group} role="group" aria-label={group||undefined}>
            {group&&<div className="select-group-label">{group}</div>}
            {filtered.map((option,index)=>option.group===group||(!option.group&&!group)?<div id={`${id}-option-${index}`} key={option.value} role="option" aria-selected={option.value===value} data-option-index={index} className={`select-option ${active===index?'is-active':''} ${option.value===value?'is-selected':''}`} onPointerMove={()=>setActive(index)} onMouseDown={event=>event.preventDefault()} onClick={()=>choose(option)}><span>{option.label}</span>{option.value===value&&<Icon name="check" size={15}/>}</div>:null)}
          </div>)}
        </div>
      </motion.div>
    </div>}</AnimatePresence>,document.body)}
  </>
}
