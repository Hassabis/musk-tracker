/** AgentUI Usage Dashboard's shared-layout range-selector pattern.
 * Source: https://www.agentui.pro/components/agents/usage-dashboard
 * Adapted to typed options and app theme; preserves controlled state,
 * useId-scoped indicator and reduced-motion behavior.
 */
import { motion, useReducedMotion } from 'motion/react'
import { useId, type ReactNode } from 'react'
const SPRING_LAYOUT={type:'spring',stiffness:360,damping:32,mass:.6} as const
export function SegmentedControl<T extends string>({value,onChange,options,label}:{value:T;onChange:(next:T)=>void;options:{value:T;label:string;icon:ReactNode}[];label:string}){
  const id=useId(),reduce=useReducedMotion()??false
  return <fieldset className="segmented agentui-segmented" aria-label={label}>{options.map(option=><button key={option.value} type="button" aria-label={option.label} aria-pressed={value===option.value} className={value===option.value?'selected':''} onClick={()=>onChange(option.value)}>{value===option.value&&<motion.span className="agentui-selection" layoutId={`${id}-selection`} transition={reduce?{duration:0}:SPRING_LAYOUT}/>}<span className="agentui-option-icon">{option.icon}</span></button>)}</fieldset>
}
