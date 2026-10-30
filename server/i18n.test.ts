import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { isLocale, resolveLocale } from '../src/i18n/locale.ts'
import { messages } from '../src/i18n/messages.ts'
import { translate } from '../src/i18n/translate.ts'
import { localeResponse } from './locale.ts'
test('country detection takes priority and covers the five requested languages',()=>{
  for(const [country,locale] of [['CN','zh'],['US','en'],['JP','ja'],['KR','ko'],['ES','es'],['MX','es'],['AR','es'],['TW','zh']])assert.equal(resolveLocale(country,'fr,ko;q=0.9'),locale)
  assert.equal(resolveLocale('DE','zh-CN'),'en')
  assert.equal(localeResponse({'x-vercel-ip-country':'JP','accept-language':'en-US'}).locale,'ja')
})
test('missing geo headers use supported browser preferences and default to English',()=>{
  assert.equal(resolveLocale(null,'fr;q=1,ja;q=0.8,ko;q=0.9'),'ko')
  assert.equal(resolveLocale(undefined,'fr-FR'),'en')
  assert.equal(resolveLocale(null,'zh-CN;q=0,en;q=0.5'),'en')
  assert.equal(resolveLocale(null,'ja; q=0.5,ko; q=0.9'),'ko')
  assert.equal(isLocale('fr'),false);assert.equal(isLocale('zh'),true)
})
test('all UI translation keys exist in every language with identical interpolation parameters',()=>{
  const files=['src/App.tsx','src/components/MarketLive.tsx','src/components/Charts.tsx','src/components/MarketPicker.tsx','src/components/Select.tsx','src/components/LanguagePicker.tsx','src/components/EasternClock.tsx','src/components/MarketForecast.tsx']
  const keys=new Set<string>()
  for(const file of files){
    const source=ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
    function visit(node:ts.Node){if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&['tr','t'].includes(node.expression.text)&&node.arguments[0]&&ts.isStringLiteral(node.arguments[0]))keys.add(node.arguments[0].text);if(file.endsWith('MarketForecast.tsx')&&ts.isStringLiteral(node)&&/[\u4e00-\u9fff]/.test(node.text))keys.add(node.text);ts.forEachChild(node,visit)}
    visit(source)
  }
  const parameters=(value:string)=>[...value.matchAll(/\{(\w+)\}/g)].map(match=>match[1]).sort()
  for(const [locale,dictionary] of Object.entries(messages)){
    for(const key of keys)assert.ok(dictionary[key],`${locale}: ${key}`)
    assert.deepEqual(Object.keys(dictionary).sort(),Object.keys(messages.en).sort())
    for(const [key,value] of Object.entries(dictionary))assert.deepEqual(parameters(value),parameters(key),`${locale}: ${key}`)
  }
  assert.equal(translate('es','最近 {p0} 天',{p0:30}),'Últimos 30 días')
  assert.equal(translate('ja','周期已过 {p0}%',{p0:90}),'期間の90%が経過')
  assert.equal(translate('zh','今日发帖'),'今日发帖')
})
