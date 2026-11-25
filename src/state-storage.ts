import { applyStateDelta, decodeText, escapeText, parseXml, type InternalState, type XmlNode } from './internal-state.js'

// Most leaves are [name, decoded text]. Mixed content and repeated elements
// retain document order. Optional tag suffixes omit the name and final `>`.
type StoredElement = [name: string, value: string | (string | StoredElement)[], openSuffix?: string, closeSpace?: string]

export interface StoredStateV2 {
  sections: Record<string, StoredElement>
  /** Legacy layout, with a #section slot for each originally present section. */
  envelope?: StoredElement
  ledger?: string
}

// The XML reader already delimited/validated these gaps. Only split out the
// spellings escapeText can't reproduce; never store a second copy of the text.
function appendGap(parts: (string | StoredElement)[], gap: string): void {
  let offset = 0
  for (const match of gap.matchAll(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|&(?:quot|apos|#[^;]+);|>/g)) {
    if (offset < match.index!) parts.push(decodeText(gap.slice(offset, match.index)))
    const token = match[0]
    if (token.startsWith('<!--')) parts.push(['#comment', token.slice(4, -3)])
    else if (token.startsWith('<![')) parts.push(['#cdata', token.slice(9, -3)])
    else parts.push(['#lex', token])
    offset = match.index! + token.length
  }
  if (offset < gap.length) parts.push(decodeText(gap.slice(offset)))
}

function packElement(xml: string, node: XmlNode, template = false): StoredElement {
  const parts: (string | StoredElement)[] = []
  let offset = node.openEnd
  for (const child of node.children) {
    appendGap(parts, xml.slice(offset, child.start))
    parts.push(template ? ['#section', child.name.slice(6)] : packElement(xml, child))
    offset = child.end
  }
  appendGap(parts, xml.slice(offset, node.closeStart))
  const body = parts.length === 1 && typeof parts[0] === 'string' ? parts[0] : parts.length ? parts : ''
  const stored: StoredElement = [node.name, body]
  const open = xml.slice(node.start + 1 + node.name.length, node.openEnd - 1)
  const close = node.selfClosing ? '' : xml.slice(node.closeStart + 2 + node.name.length, node.end - 1)
  if (open || close) stored.push(open)
  if (close) stored.push(close)
  return stored
}

function unpackElement([name, value, open = '', close = '']: StoredElement, slots?: Record<string, string>): string {
  if (name === '#section' && typeof value === 'string' && slots && Object.hasOwn(slots, value)) return slots[value]
  if (name === '#comment') return `<!--${value}-->`
  if (name === '#cdata') return `<![CDATA[${value}]]>`
  if (name === '#lex' && typeof value === 'string') return value
  const start = `<${name}${open}>`
  if (open.endsWith('/')) return start
  const body = typeof value === 'string' ? escapeText(value) : value.map(part =>
    typeof part === 'string' ? escapeText(part) : unpackElement(part, slots)).join('')
  return `${start}${body}</${name}${close}>`
}

export function encodeStoredState(state: InternalState): StoredStateV2 {
  const valid = applyStateDelta(state, {})
  const stored: StoredStateV2 = { sections: Object.fromEntries(Object.entries(valid.sections).map(([name, xml]) => [name, packElement(xml, parseXml(xml))])) }
  if (valid.ledger !== undefined) stored.ledger = valid.ledger
  if (valid.envelope !== undefined) stored.envelope = packElement(valid.envelope, parseXml(valid.envelope), true)
  return stored
}

// Storage comes from JSON. Reject non-JSON properties without invoking getters,
// and ensure malformed tuples cannot silently turn into a different XML tree.
function checkJson(value: unknown, active = new Set<object>()): void {
  if (typeof value === 'string') return
  if (!value || typeof value !== 'object' || active.has(value)) throw new Error('Invalid saved state value')
  const array = Array.isArray(value), proto = Object.getPrototypeOf(value)
  if (array ? proto !== Array.prototype : proto !== Object.prototype && proto !== null) throw new Error('Invalid saved state prototype')
  active.add(value)
  const keys = Reflect.ownKeys(value)
  if (array && keys.length !== value.length + 1) throw new Error('Invalid saved state array')
  for (const k of keys) {
    if (array && k === 'length') continue
    if (typeof k !== 'string' || ['constructor','prototype','__proto__'].includes(k) || (array && (!/^(0|[1-9]\d*)$/.test(k) || Number(k) >= value.length))) throw new Error('Invalid saved state key')
    const d = Object.getOwnPropertyDescriptor(value,k)!
    if (!d.enumerable || !('value' in d)) throw new Error('Invalid saved state property')
    checkJson(d.value,active)
  }
  active.delete(value)
}

export function decodeStoredState(payload: unknown): InternalState {
  checkJson(payload)
  const stored = payload as StoredStateV2
  if (!stored || typeof stored !== 'object' || Array.isArray(stored) || !stored.sections || typeof stored.sections !== 'object' || Array.isArray(stored.sections) || Object.keys(stored).some(k => !['sections','ledger','envelope'].includes(k))) throw new Error('Invalid saved state record')
  const sections = Object.fromEntries(Object.entries(stored.sections).map(([name, value]) => [name, unpackElement(value)]))
  const state: InternalState = { sections }
  if (stored.ledger !== undefined) state.ledger = stored.ledger
  if (stored.envelope !== undefined) state.envelope = unpackElement(stored.envelope, sections)
  // Re-encoding checks lexical tokens, XML structure, slots and top-level names
  // against the exact canonical grammar used by the writer (without trusting raw fragments).
  const canonical = encodeStoredState(state)
  if (Object.entries(stored).some(([key,v]) => JSON.stringify(v) !== JSON.stringify(canonical[key as keyof StoredStateV2]))) throw new Error('Malformed or noncanonical saved state tree')
  return state
}
