/**
 * Adapted from AgentUI ReasoningText (manual copy distribution).
 * Source: https://www.agentui.pro/components/agents/loading-states
 * Retrieved: 2026-10-29. Retains cascade/swap, layout reservation and a11y.
 * App-specific changes: omit unused scramble variant and shared utility packages;
 * use a supplied indicator and local CSS theme. No claim of an official Vue port.
 */
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useEffect, useId, useState, type ReactNode } from 'react'
const EASE_OUT = [0.16, 1, 0.3, 1] as const
const SPRING_SWAP = { type: 'spring', stiffness: 460, damping: 30, mass: 0.55 } as const
const CASCADE_STAGGER = 0.025
const DEFAULT_PHRASES = ['正在同步']
export interface ReasoningTextProps {
  phrases?: string[]
  variant?: 'cascade' | 'swap'
  interval?: number
  shimmerDuration?: number
  indicator?: ReactNode
  className?: string
}
export function ReasoningText({phrases=DEFAULT_PHRASES,variant='swap',interval=1800,shimmerDuration=2.2,indicator,className=''}:ReasoningTextProps){
  const reduce=useReducedMotion()??false
  const [index,setIndex]=useState(0)
  const statusId=useId()
  const safePhrases=phrases.length>0?phrases:DEFAULT_PHRASES
  const phrase=safePhrases[index%safePhrases.length]
  const longestPhrase=safePhrases.reduce((longest,current)=>current.length>longest.length?current:longest)
  const style={animation:`agentui-text-shimmer ${shimmerDuration}s linear infinite`}
  useEffect(()=>{if(safePhrases.length<2)return;const timer=window.setInterval(()=>setIndex(current=>(current+1)%safePhrases.length),Math.max(600,interval));return()=>window.clearInterval(timer)},[interval,safePhrases.length])
  return <span role="status" aria-live="polite" aria-labelledby={statusId} className={`agentui-reasoning ${className}`}>
    {indicator&&<span aria-hidden="true" className="agentui-indicator">{indicator}</span>}
    <span aria-hidden="true" className="agentui-phrase-grid">
      <span className="agentui-reserved">{longestPhrase}…</span>
      <AnimatePresence initial={false}>
        {variant==='cascade'&&!reduce?<motion.span key={phrase} className="agentui-phrase" initial="initial" animate="animate" exit="exit">{`${phrase}…`.split('').map((character,characterIndex)=><motion.span key={characterIndex} custom={characterIndex*CASCADE_STAGGER} variants={{initial:{opacity:0,y:'100%'},animate:(delay:number)=>({opacity:1,y:'0%',transition:{...SPRING_SWAP,delay}}),exit:(delay:number)=>({opacity:0,y:'-100%',transition:{duration:.14,ease:EASE_OUT,delay:delay*.45}})}} className="agentui-letter agentui-text-shimmer" style={style}>{character}</motion.span>)}</motion.span>:<motion.span key={phrase} className="agentui-phrase agentui-text-shimmer" style={style} initial={reduce?{opacity:0}:{opacity:0,y:3}} animate={reduce?{opacity:1}:{opacity:1,y:0}} exit={reduce?{opacity:0}:{opacity:0,y:-3}} transition={{duration:reduce?.12:.2,ease:EASE_OUT}}>{phrase}…</motion.span>}
      </AnimatePresence>
    </span>
    <span id={statusId} className="sr-only">{phrase}</span>
  </span>
}
