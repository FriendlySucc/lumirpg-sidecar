export const STATE_SECTIONS = [
  'world', 'onscreen', 'offscreen_agendas', 'locations', 'entityMem', 'entity_state',
  'thoughts', 'dam', 'pair', 'reputation', 'tracks', 'arc', 'chekhov', 'leads', 'inv',
  'story_notes', 'notebook', 'vent',
] as const

export interface InternalState {
  sections: Record<string, string>
  ledger?: string
  /** Original validated envelope, used as a lossless rendering template. */
  envelope?: string
}
export interface StateMessage { role: string; content: string }

interface XmlNode {
  name: string
  start: number
  openEnd: number
  closeStart: number
  end: number
  selfClosing: boolean
  children: XmlNode[]
}

const XML_NAME = '[A-Za-z_][A-Za-z0-9_.:-]*'
const VALID_SECTION = new Set<string>(STATE_SECTIONS)

/** A deliberately conservative XML fragment reader. It preserves original bytes. */
function parseXml(xml: string): XmlNode {
  for (const character of xml) {
    const code = character.codePointAt(0)!
    if (!(code === 9 || code === 10 || code === 13 || (code >= 0x20 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0xfffd) || (code >= 0x10000 && code <= 0x10ffff))) throw new Error('Invalid XML character')
  }
  const stack: XmlNode[] = []
  let root: XmlNode | undefined
  let pos = 0
  const checkText = (text: string) => {
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(text) || text.includes(']]>')) throw new Error('Invalid XML text')
    if (/&(?!(?:amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);)/.test(text)) throw new Error('Invalid XML entity')
    for (const match of text.matchAll(/&#(x[0-9a-fA-F]+|[0-9]+);/g)) {
      const code = match[1][0] === 'x' ? parseInt(match[1].slice(1), 16) : parseInt(match[1], 10)
      if (!(code === 9 || code === 10 || code === 13 || (code >= 0x20 && code <= 0xd7ff) || (code >= 0xe000 && code <= 0xfffd) || (code >= 0x10000 && code <= 0x10ffff))) throw new Error('Invalid XML character')
    }
  }
  while (pos < xml.length) {
    if (xml[pos] !== '<') {
      const next = xml.indexOf('<', pos)
      const end = next < 0 ? xml.length : next
      const text = xml.slice(pos, end)
      checkText(text)
      if (!stack.length && text.trim()) throw new Error('Text outside XML root')
      pos = end
      continue
    }
    if (xml.startsWith('<!--', pos)) {
      const end = xml.indexOf('-->', pos + 4)
      if (end < 0 || xml.slice(pos + 4, end).includes('--') || !stack.length) throw new Error('Invalid XML comment')
      pos = end + 3
      continue
    }
    if (xml.startsWith('<![CDATA[', pos)) {
      const end = xml.indexOf(']]>', pos + 9)
      if (end < 0 || !stack.length) throw new Error('Invalid XML CDATA')
      pos = end + 3
      continue
    }
    if (xml.startsWith('<!', pos) || xml.startsWith('<?', pos)) throw new Error('Unsupported XML declaration')
    let end = pos + 1
    let quote = ''
    for (; end < xml.length; end++) {
      const c = xml[end]
      if (quote) { if (c === quote) quote = '' }
      else if (c === '"' || c === "'") quote = c
      else if (c === '>') break
      else if (c === '<') throw new Error('Invalid XML tag')
    }
    if (end === xml.length || quote) throw new Error('Incomplete XML tag')
    const token = xml.slice(pos, end + 1)
    if (token.startsWith('</')) {
      const closing = new RegExp(`^<\\/(${XML_NAME})\\s*>$`).exec(token)
      const node = stack.pop()
      if (!closing || !node || node.name !== closing[1]) throw new Error('Mismatched XML tag')
      node.closeStart = pos
      node.end = end + 1
    } else {
      const opening = new RegExp(`^<(${XML_NAME})([\\s\\S]*?)>$`).exec(token)
      if (!opening) throw new Error('Invalid XML tag')
      let attrs = opening[2]
      const selfClosing = attrs.endsWith('/')
      if (selfClosing) attrs = attrs.slice(0, -1)
      const attrPattern = new RegExp(`^\\s+(${XML_NAME})\\s*=\\s*("[^"]*"|'[^']*')`)
      const seen = new Set<string>()
      while (attrs.trim()) {
        const attr = attrPattern.exec(attrs)
        if (!attr || seen.has(attr[1])) throw new Error('Invalid XML attribute')
        seen.add(attr[1])
        if (attr[2].includes('<')) throw new Error('Invalid XML attribute')
        checkText(attr[2].slice(1, -1))
        attrs = attrs.slice(attr[0].length)
      }
      const node: XmlNode = { name: opening[1], start: pos, openEnd: end + 1, closeStart: end + 1, end: end + 1, selfClosing, children: [] }
      if (stack.length) stack[stack.length - 1].children.push(node)
      else if (root) throw new Error('Multiple XML roots')
      else root = node
      if (!selfClosing) stack.push(node)
    }
    pos = end + 1
  }
  if (!root || stack.length) throw new Error('Incomplete XML')
  return root
}

function envelopeRoot(xml: string): XmlNode {
  const root = parseXml(xml)
  if (root.name !== 'internal_states' || root.start !== 0 || root.end !== xml.length) throw new Error('Invalid internal state envelope')
  const seen = new Set<string>()
  let offset = root.openEnd
  for (const child of root.children) {
    const gap = xml.slice(offset, child.start).replace(/<!--[\s\S]*?-->/g, '')
    if (gap.trim()) throw new Error('Unexpected internal state content')
    const name = child.name.startsWith('state:') ? child.name.slice(6) : ''
    if (!VALID_SECTION.has(name) || seen.has(name)) throw new Error('Unknown or duplicate state section')
    seen.add(name)
    offset = child.end
  }
  if (!root.selfClosing && xml.slice(offset, root.closeStart).replace(/<!--[\s\S]*?-->/g, '').trim()) throw new Error('Unexpected internal state content')
  return root
}

function maskComments(content: string): string {
  let output = ''
  let cursor = 0
  for (;;) {
    const start = content.indexOf('<!--', cursor)
    if (start < 0) return output + content.slice(cursor)
    const end = content.indexOf('-->', start + 4)
    const stop = end < 0 ? content.length : end + 3
    output += content.slice(cursor, start) + ' '.repeat(stop - start)
    cursor = stop
  }
}

function legacyLedger(content: string): string | undefined {
  const visible = maskComments(content)
  const matches = [...visible.matchAll(/<details\b[^>]*>/gi)].filter(match => {
    const attribute = /\sclass\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(match[0])
    return (attribute?.[1] ?? attribute?.[2] ?? '').split(/\s+/).includes('ldg-source')
  })
  if (!matches.length) return undefined
  if (matches.length > 1) throw new Error('Ambiguous Ledger')
  const marker = matches[0]
  const close = /<\/details\s*>/gi
  close.lastIndex = marker.index! + marker[0].length
  const end = close.exec(visible)
  if (!end) throw new Error('Incomplete Ledger')
  const ledger = content.slice(marker.index, end.index + end[0].length)
  const root = parseXml(ledger)
  if (root.name !== 'details') throw new Error('Invalid Ledger')
  return ledger
}

export interface LegacyImportSelection {
  /** Explicitly select missing section names and/or missing record identities. */
  sections?: string[]
  records?: Record<string, string[]>
}

/** Latest envelope wins. Earlier imports require explicit caller selection. */
export function migrateLastInternalState(messages: StateMessage[], selection?: LegacyImportSelection): InternalState {
  const envelopes: InternalState[] = []
  const selected = selection === undefined ? undefined : plainObject(selection, 'legacy selection')
  if (selected) onlyKeys(selected, ['sections', 'records'], 'legacy selection')
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role !== 'assistant') continue
    const content = messages[i].content
    const visible = maskComments(content)
    const markers = [...visible.matchAll(/<\/?internal_states(?=[\s/>]|$)/gi)]
    if (!markers.length) {
      if (/<\/?state:[A-Za-z_]/.test(visible)) throw new Error('State section outside envelope')
      if (!envelopes.length) {
        const ledger = legacyLedger(content)
        if (ledger !== undefined) {
          envelopes.push({ sections: {}, ledger })
          if (!selected) return envelopes[0]
        }
      }
      continue
    }
    if (markers.length % 2 !== 0 || markers.some((marker, index) => marker[0].startsWith('</') !== (index % 2 === 1))) throw new Error('Incomplete internal state envelope')
    let lastEnd = 0
    for (let index = 0; index < markers.length; index += 2) {
      const open = markers[index]
      const close = markers[index + 1]
      if (/<\/?state:[A-Za-z_]/.test(visible.slice(lastEnd, open.index))) throw new Error('State section outside envelope')
      const end = content.indexOf('>', close.index)
      if (end < 0) throw new Error('Incomplete internal state envelope')
      lastEnd = end + 1
    }
    if (/<\/?state:[A-Za-z_]/.test(visible.slice(lastEnd))) throw new Error('State section outside envelope')
    for (let index = markers.length - 1; index >= 0; index -= 2) {
      const close = markers[index]
      const open = markers[index - 1]
      if (!close[0].startsWith('</') || !open || open[0].startsWith('</')) throw new Error('Incomplete internal state envelope')
      const end = content.indexOf('>', close.index)
      if (end < 0) throw new Error('Incomplete internal state envelope')
      const xml = content.slice(open.index, end + 1)
      const root = envelopeRoot(xml)
      const sections: Record<string, string> = {}
      for (const child of root.children) sections[child.name.slice(6)] = xml.slice(child.start, child.end)
      const ledger = envelopes.length ? undefined : legacyLedger(content)
      envelopes.push(ledger === undefined ? { sections, envelope: xml } : { sections, ledger, envelope: xml })
      if (!selected) return envelopes[0]
    }
  }
  if (!envelopes.length) {
    if (selected && Object.keys(selected).length) throw new Error('No legacy state found')
    return { sections: {} }
  }
  return importSelected(envelopes, selected!)
}

const SCALAR_FIELDS: Record<string, readonly string[]> = {
  world: ['ct', 'loc', 'time', 'date', 'weather', 'room', 'user_pos', 'entries', 'obstacles', 'audio', 'pacing'],
  inv: ['inv', 'titles', 'status'],
  story_notes: ['threads', 'seeds', 'motives', 'horizon', 'GremlinNote', 'heckle'],
  vent: ['vent'],
}

const RECORDS: Record<string, {tag: string; identity: string; fields: readonly string[]}> = {
  onscreen: { tag: 'ent_on', identity: 'name', fields: ['parrott','residualMood','tfdy','salience','agenda','why','end','move'] },
  offscreen_agendas: { tag: 'ent_off', identity: 'name', fields: ['loc','agenda','why','goal','end','mood','tfdy','salience'] },
  entity_state: { tag: 'ent_col', identity: 'name', fields: ['fontColor','look','voice','persona','private'] },
  entityMem: { tag: 'ent_mem', identity: 'name', fields: [] },
  thoughts: { tag: 'ent_think', identity: 'name', fields: ['tQ1','tQ2','tQ3','tQ4','tQ5'] },
  dam: { tag: 'ent_dam', identity: 'pair', fields: ['sluice','filters','misc','intent'] },
  pair: { tag: 'pair', identity: 'names', fields: ['mode','dam','matrix','wall'] },
}

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function decodeText(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|apos|#[0-9]+|#x[0-9a-fA-F]+);/g, entity => {
    const standard: Record<string, string> = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'" }
    if (Object.hasOwn(standard, entity)) return standard[entity]
    return String.fromCodePoint(entity[2] === 'x' ? parseInt(entity.slice(3, -1), 16) : parseInt(entity.slice(2, -1), 10))
  })
}

function nodeText(xml: string, node: XmlNode): string {
  if (node.children.length) throw new Error('Non-scalar XML field')
  if (node.selfClosing) return ''
  const text = xml.slice(node.openEnd, node.closeStart)
  if (text.includes('<')) throw new Error('Non-scalar XML field')
  return decodeText(text)
}

function insertInto(xml: string, node: XmlNode, content: string): string {
  if (node.selfClosing) {
    const opening = xml.slice(node.start, node.openEnd).replace(/\/\s*>$/, '>')
    return xml.slice(0, node.start) + opening + content + `</${node.name}>` + xml.slice(node.end)
  }
  return xml.slice(0, node.closeStart) + content + xml.slice(node.closeStart)
}

function setDirectFields(xml: string, parent: XmlNode, fields: Record<string, unknown>, allowed: readonly string[], context: string): string {
  const edits: { start: number; end: number; text: string }[] = []
  let append = ''
  for (const [field, raw] of Object.entries(fields)) {
    if (!allowed.includes(field)) throw new Error(`Invalid record field "${field}" in ${context} (allowed: ${allowed.join(', ')})`)
    const text = typeof raw === 'string' ? raw : typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : null
    if (text === null) throw new Error(`Invalid record field "${field}" in ${context}: expected string`)
    const matches = parent.children.filter(child => child.name === field)
    if (matches.length > 1) throw new Error('Ambiguous record field')
    const replacement = `<${field}>${escapeText(text)}</${field}>`
    if (!matches.length) append += replacement
    else {
      const match = matches[0]
      if (match.children.length || (!match.selfClosing && xml.slice(match.openEnd, match.closeStart).includes('<'))) throw new Error('Non-scalar XML field')
      const opening = xml.slice(match.start, match.openEnd)
      if (/\s+[A-Za-z_:]/.test(opening)) throw new Error('Field attributes cannot be replaced')
      edits.push({ start: match.start, end: match.end, text: replacement })
    }
  }
  if (append) {
    if (parent.selfClosing) {
      const opening = xml.slice(parent.start, parent.openEnd).replace(/\/\s*>$/, '>')
      edits.push({ start: parent.start, end: parent.end, text: opening + append + `</${parent.name}>` })
    } else edits.push({ start: parent.closeStart, end: parent.closeStart, text: append })
  }
  for (const edit of edits.sort((a, b) => b.start - a.start)) xml = xml.slice(0, edit.start) + edit.text + xml.slice(edit.end)
  return xml
}

function updateRecordSection(section: string, sectionName: string, records: unknown): string {
  const spec = Object.hasOwn(RECORDS, sectionName) ? RECORDS[sectionName] : undefined
  if (!spec || !Array.isArray(records)) throw new Error(`Invalid ${sectionName} records`)
  for (const entry of records) {
    const row = plainObject(entry, 'record')
    onlyKeys(row, ['name', 'fields'], 'record')
    if (typeof row.name !== 'string' || !row.name.trim()) throw new Error('Invalid record identity')
    const rawFields = plainObject(row.fields, 'record fields')
    const fields: Record<string, unknown> = {}
    for (const [key, val] of Object.entries(rawFields)) {
      if (key === spec.identity && val === row.name) continue
      fields[key] = val
    }
    const root = sectionRoot(section, sectionName)
    const candidates = root.children.filter(child => {
      if (child.name !== spec.tag) return false
      const ids = child.children.filter(item => item.name === spec.identity)
      if (ids.length !== 1) throw new Error('Invalid record identity')
      return nodeText(section, ids[0]) === row.name
    })
    if (candidates.length > 1) throw new Error('Ambiguous record identity')
    if (!candidates.length) {
      const record = `<${spec.tag}><${spec.identity}>${escapeText(row.name)}</${spec.identity}></${spec.tag}>`
      section = insertInto(section, root, record)
      const newRoot = sectionRoot(section, sectionName)
      section = setDirectFields(section, newRoot.children[newRoot.children.length - 1], fields, spec.fields, sectionName)
    } else section = setDirectFields(section, candidates[0], fields, spec.fields, sectionName)
    sectionRoot(section, sectionName)
  }
  return section
}

function importSelected(envelopes: InternalState[], selection: Record<string, unknown>): InternalState {
  const result: InternalState = { ...envelopes[0], sections: { ...envelopes[0].sections } }
  if (Object.hasOwn(selection, 'sections')) {
    if (!Array.isArray(selection.sections)) throw new Error('Invalid section selection')
    const seen = new Set<string>()
    for (const name of selection.sections) {
      if (typeof name !== 'string' || !VALID_SECTION.has(name) || seen.has(name)) throw new Error('Invalid section selection')
      seen.add(name)
      if (Object.hasOwn(result.sections, name)) throw new Error('Selected section already exists')
      const source = envelopes.slice(1).find(item => Object.hasOwn(item.sections, name))
      if (!source) throw new Error('Selected section not found')
      result.sections[name] = source.sections[name]
    }
  }
  if (Object.hasOwn(selection, 'records')) {
    const selections = plainObject(selection.records, 'record selection')
    for (const [name, identities] of Object.entries(selections)) {
      const spec = Object.hasOwn(RECORDS, name) ? RECORDS[name] : undefined
      if (!spec || !Object.hasOwn(result.sections, name) || !Array.isArray(identities)) throw new Error('Invalid record selection')
      const seen = new Set<string>()
      for (const identity of identities) {
        if (typeof identity !== 'string' || !identity.trim() || seen.has(identity)) throw new Error('Invalid record selection')
        seen.add(identity)
        const candidates = (xml: string): XmlNode[] => {
          const root = sectionRoot(xml, name)
          return root.children.filter(child => {
            if (child.name !== spec.tag) return false
            const ids = child.children.filter(item => item.name === spec.identity)
            if (ids.length !== 1) throw new Error('Invalid record identity')
            return nodeText(xml, ids[0]) === identity
          })
        }
        if (candidates(result.sections[name]).length) throw new Error('Selected record already exists')
        let found: string | undefined
        for (const envelope of envelopes.slice(1)) {
          const source = envelope.sections[name]
          if (!source) continue
          const matches = candidates(source)
          if (matches.length > 1) throw new Error('Ambiguous legacy record')
          if (matches.length) { found = source.slice(matches[0].start, matches[0].end); break }
        }
        if (!found) throw new Error('Selected record not found')
        const current = result.sections[name]
        result.sections[name] = insertInto(current, sectionRoot(current, name), found)
      }
    }
  }
  return result
}

function appendMemories(section: string, proposed: unknown): string {
  if (!Array.isArray(proposed)) throw new Error('Invalid memory patch')
  for (const entry of proposed) {
    const row = plainObject(entry, 'memory record')
    onlyKeys(row, ['name', 'entries'], 'memory record')
    if (typeof row.name !== 'string' || !row.name.trim() || !Array.isArray(row.entries)) throw new Error('Invalid memory record')
    const root = sectionRoot(section, 'entityMem')
    const candidates = root.children.filter(child => {
      if (child.name !== 'ent_mem') return false
      const ids = child.children.filter(item => item.name === 'name')
      if (ids.length !== 1) throw new Error('Invalid memory identity')
      return nodeText(section, ids[0]) === row.name
    })
    if (candidates.length > 1) throw new Error('Ambiguous memory identity')
    const existing = new Set(candidates[0]?.children.filter(item => item.name === 'mem').map(item => nodeText(section, item)) ?? [])
    let additions = ''
    for (const value of row.entries) {
      if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid memory entry')
      if (!existing.has(value)) {
        additions += `<mem>${escapeText(value)}</mem>`
        existing.add(value)
      }
    }
    if (additions) {
      if (candidates.length) section = insertInto(section, candidates[0], additions)
      else section = insertInto(section, root, `<ent_mem><name>${escapeText(row.name)}</name>${additions}</ent_mem>`)
      sectionRoot(section, 'entityMem')
    }
  }
  return section
}

function pathTag(value: unknown): string {
  if (typeof value !== 'string' || !new RegExp(`^${XML_NAME}$`).test(value) || value.startsWith('state:')) throw new Error('Invalid path tag')
  return value
}

function resolvePath(xml: string, root: XmlNode, path: unknown): XmlNode {
  if (!Array.isArray(path)) throw new Error('Invalid operation path')
  let current = root
  for (const step of path) {
    let tag: string
    let where: Record<string, unknown> | undefined
    if (typeof step === 'string') tag = pathTag(step)
    else {
      const selector = plainObject(step, 'path selector')
      onlyKeys(selector, ['tag', 'where'], 'path selector')
      tag = pathTag(selector.tag)
      if (Object.hasOwn(selector, 'where')) {
        where = plainObject(selector.where, 'path identity')
        onlyKeys(where, ['tag', 'value'], 'path identity')
        pathTag(where.tag)
        if (typeof where.value !== 'string') throw new Error('Invalid path identity')
      }
    }
    const candidates = current.children.filter(child => {
      if (child.name !== tag) return false
      if (!where) return true
      const ids = child.children.filter(id => id.name === where!.tag)
      if (ids.length !== 1) throw new Error('Invalid path identity')
      return nodeText(xml, ids[0]) === where.value
    })
    if (candidates.length !== 1) throw new Error('Missing or ambiguous operation path')
    current = candidates[0]
  }
  return current
}

/** Generic bounded edits apply to existing XML paths, never a guessed schema. */
function applyOperations(section: string, name: string, operations: unknown): string {
  if (!Array.isArray(operations) || !operations.length) throw new Error('Invalid operations')
  for (const item of operations) {
    const operation = plainObject(item, 'operation')
    const root = sectionRoot(section, name)
    if (operation.op === 'set') {
      onlyKeys(operation, ['op', 'path', 'value'], 'operation')
      if (typeof operation.value !== 'string') throw new Error('Invalid set value')
      const target = resolvePath(section, root, operation.path)
      if (['name', 'names', 'pair'].includes(target.name)) throw new Error('Identity fields cannot be changed by generic set')
      if (target === root || target.children.length || (!target.selfClosing && section.slice(target.openEnd, target.closeStart).includes('<'))) throw new Error('Set target is not scalar')
      if (/\s+[A-Za-z_:]/.test(section.slice(target.start, target.openEnd))) throw new Error('Field attributes cannot be replaced')
      const replacement = `<${target.name}>${escapeText(operation.value)}</${target.name}>`
      section = section.slice(0, target.start) + replacement + section.slice(target.end)
    } else if (operation.op === 'append') {
      onlyKeys(operation, ['op', 'path', 'xml'], 'operation')
      if (typeof operation.xml !== 'string') throw new Error('Invalid append content')
      const fragment = parseXml(operation.xml)
      if (fragment.start !== 0 || fragment.end !== operation.xml.length || fragment.name.startsWith('state:') || fragment.name === 'internal_states') throw new Error('Invalid append element')
      const target = resolvePath(section, root, operation.path)
      for (const identity of ['name', 'names', 'pair']) {
        const ids = fragment.children.filter(child => child.name === identity)
        if (ids.length > 1) throw new Error('Ambiguous appended identity')
        if (!ids.length) continue
        const value = nodeText(operation.xml, ids[0])
        for (const sibling of target.children.filter(child => child.name === fragment.name)) {
          const existing = sibling.children.filter(child => child.name === identity)
          if (existing.length > 1) throw new Error('Ambiguous existing identity')
          if (existing.length && nodeText(section, existing[0]) === value) throw new Error('Duplicate appended record')
        }
      }
      section = insertInto(section, target, operation.xml)
    } else throw new Error('Invalid operation')
    sectionRoot(section, name)
  }
  return section
}

function plainObject(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${label}`)
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) throw new Error(`Invalid ${label} prototype`)
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || ['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error(`Invalid ${label} key`)
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !('value' in descriptor)) throw new Error(`Invalid ${label} property`)
  }
  return value as Record<string, unknown>
}

function onlyKeys(obj: Record<string, unknown>, keys: readonly string[], label: string): void {
  if (Object.keys(obj).some(key => !keys.includes(key))) throw new Error(`Invalid ${label} key`)
}

function sectionRoot(section: string, name: string): XmlNode {
  const root = parseXml(section)
  if (root.name !== `state:${name}` || root.start !== 0 || root.end !== section.length) throw new Error(`Invalid ${name} section`)
  return root
}

function isEmptySection(section: string, name: string): boolean {
  const root = sectionRoot(section, name)
  if (root.children.length > 0) return false
  if (root.selfClosing) return true
  const inner = section.slice(root.openEnd, root.closeStart).replace(/\u2800+/g, ' ').trim()
  return !inner || inner === '∅' || inner === 'Ø' || inner === '—' || inner === '-'
}

/** Apply updates transactionally. Reject malformed operations rather than ignoring them. */
export function applyStateDelta(current: InternalState, delta: Record<string, unknown>): InternalState {
  const state = plainObject(current, 'state')
  onlyKeys(state, ['sections', 'ledger', 'envelope'], 'state')
  if (Object.hasOwn(state, 'ledger') && (typeof state.ledger !== 'string' || legacyLedger(state.ledger) !== state.ledger)) throw new Error('Invalid Ledger')
  if (Object.hasOwn(state, 'envelope')) {
    if (typeof state.envelope !== 'string') throw new Error('Invalid envelope')
    envelopeRoot(state.envelope)
  }
  const previous = plainObject(state.sections, 'sections')
  if (typeof state.envelope === 'string' && envelopeRoot(state.envelope).children.some(child => !Object.hasOwn(previous, child.name.slice(6)))) throw new Error('Envelope section missing from state')
  const sections: Record<string, string> = {}
  for (const [name, value] of Object.entries(previous)) {
    if (!VALID_SECTION.has(name) || typeof value !== 'string') throw new Error('Invalid current state section')
    sectionRoot(value, name)
    sections[name] = value
  }
  const changes = plainObject(delta, 'delta')
  for (const [name, value] of Object.entries(changes)) {
    if (!VALID_SECTION.has(name)) throw new Error('Invalid state section')
    if (typeof value === 'string') {
      sectionRoot(value, name)
      if (Object.hasOwn(sections, name) && sections[name] !== value && !isEmptySection(sections[name], name)) {
        throw new Error(`Use bounded edits for existing ${name} section`)
      }
      sections[name] = value
      continue
    }
    const operation = plainObject(value, `${name} patch`)
    const keys = Object.keys(operation)
    if (keys.length !== 1) throw new Error(`Invalid ${name} patch`)
    if (keys[0] === 'operations' || keys[0] === 'ops') {
      // Memory is append-only by contract: generic set/append could rewrite or
      // duplicate established facts, so it must use the bounded append patch.
      if (name === 'entityMem') throw new Error('Generic ops are not allowed on entityMem')
      if (!Object.hasOwn(sections, name)) throw new Error(`Missing ${name} section`)
      sections[name] = applyOperations(sections[name], name, operation[keys[0]])
      continue
    }
    if (name === 'entityMem' && keys[0] === 'append') {
      const section = sections[name] || '<state:entityMem></state:entityMem>'
      const result = appendMemories(section, operation.append)
      if (Object.hasOwn(sections, name) || result !== section) sections[name] = result
      continue
    }
    if (keys[0] === 'records') {
      const section = sections[name] || `<state:${name}></state:${name}>`
      const result = updateRecordSection(section, name, operation.records)
      if (Object.hasOwn(sections, name) || result !== section) sections[name] = result
      continue
    }
    if (keys[0] !== 'fields' || !SCALAR_FIELDS[name]) throw new Error(`Invalid ${name} patch`)
    const fields = plainObject(operation.fields, `${name} fields`)
    const section = sections[name] || `<state:${name}></state:${name}>`
    const result = setDirectFields(section, sectionRoot(section, name), fields, SCALAR_FIELDS[name], name)
    sectionRoot(result, name)
    if (Object.hasOwn(sections, name) || result !== section) sections[name] = result
  }
  return { sections, ...(current.ledger === undefined ? {} : { ledger: current.ledger }), ...(current.envelope === undefined ? {} : { envelope: current.envelope }) }
}

/** Render reference context only; caller decides where it is injected. */
export function renderStateForPrompt(state: InternalState): string {
  const valid = applyStateDelta(state, {})
  const remaining = new Set(Object.keys(valid.sections))
  let envelope = valid.envelope ?? ''
  if (envelope) {
    const root = envelopeRoot(envelope)
    for (const child of [...root.children].reverse()) {
      const name = child.name.slice(6)
      if (!Object.hasOwn(valid.sections, name)) throw new Error('Envelope section missing from state')
      remaining.delete(name)
      envelope = envelope.slice(0, child.start) + valid.sections[name] + envelope.slice(child.end)
    }
    const additions = STATE_SECTIONS.filter(name => remaining.has(name)).map(name => valid.sections[name])
    if (additions.length) envelope = insertInto(envelope, envelopeRoot(envelope), `\n${additions.join('\n')}\n`)
  } else {
    const parts = STATE_SECTIONS.flatMap(name => Object.hasOwn(valid.sections, name) ? [valid.sections[name]] : [])
    envelope = parts.length ? `<internal_states>\n${parts.join('\n')}\n</internal_states>` : ''
  }
  return [envelope, valid.ledger ?? ''].filter(Boolean).join('\n')
}
