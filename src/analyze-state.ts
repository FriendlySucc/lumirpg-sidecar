import {
  applyStateDelta, decodeText, escapeText, onlyKeys, plainObject, RECORDS, SCALAR_FIELDS, sectionRoot,
  SECTION_CONTAINERS, SECTION_SCALAR_CHILDREN, STATE_SECTIONS, type InternalState, type XmlNode,
} from './internal-state.js'

type Json = string | null | Json[] | View
interface View { [key: string]: Json }

function direct(parent: XmlNode | undefined, tag: string): XmlNode[] {
  return parent?.children.filter(child => child.name === tag) ?? []
}

function single(parent: XmlNode | undefined, tag: string): XmlNode | undefined {
  const matches = direct(parent, tag)
  if (matches.length > 1) throw new Error(`Ambiguous ${parent!.name}.${tag}`)
  return matches[0]
}

const MARKUP = /<(?:[A-Za-z_:][\w.:\-]*(?=[\s/>]|$)|[!/?])/
const INVALID_XML_CHAR = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ud800-\udfff\ufffe\uffff]/u

function plainText(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.replace(/\u2800/g, ' ').trim() || MARKUP.test(value) || INVALID_XML_CHAR.test(value)) {
    throw new Error(`Expected nonblank plain text in ${label}`)
  }
  return value
}

// Like plainObject, insist on JSON data properties before accessing any item.
function jsonArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype ||
    Reflect.ownKeys(value).length !== value.length + 1) throw new Error(`Invalid ${label} array`)
  for (let i = 0; i < value.length; i++) {
    const d = Object.getOwnPropertyDescriptor(value, i)
    if (!d?.enumerable || !('value' in d)) throw new Error(`Invalid ${label} item`)
  }
  return value
}

interface TextRun { start: number; end: number; value: string; cdata: boolean }

// Input is already parsed/validated. Work only inside a childless element. Never
// flatten descendant text, or decode entities inside comments/CDATA as markup.
function textRuns(xml: string, node: XmlNode): TextRun[] {
  const runs: TextRun[] = []
  const inner = xml.slice(node.openEnd, node.closeStart)
  for (const match of inner.matchAll(/<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|[^<]+/g)) {
    if (match[0].startsWith('<!--')) continue
    const cdata = match[1] !== undefined
    const start = node.openEnd + match.index! + (cdata ? 9 : 0)
    const raw = cdata ? match[1] : match[0]
    runs.push({ start, end: start + raw.length, value: cdata ? raw : decodeText(raw), cdata })
  }
  return runs
}

function scalar(xml: string, node: XmlNode): string | undefined {
  if (node.children.length) return undefined
  const value = textRuns(xml, node).map(run => run.value).join('')
  return MARKUP.test(value) ? undefined : value
}

// Keep original entity spellings in unchanged ends of the affected text run.
// Compare characters, not UTF-16 offsets: one numeric reference can be astral.
function replaceText(raw: string, value: string): string {
  if (!/[&>]/.test(raw)) return escapeText(value)
  const old = raw.match(/&[^;]+;|./gsu) ?? []
  const next = [...value]
  const equal = (a: string, b: string) => (a[0] === '&' ? decodeText(a) : a) === b
  let begin = 0, end = old.length, nextEnd = next.length
  while (begin < end && begin < nextEnd && equal(old[begin], next[begin])) begin++
  while (end > begin && nextEnd > begin && equal(old[end - 1], next[nextEnd - 1])) { end--; nextEnd-- }
  return (old.slice(0, begin).join('') + escapeText(next.slice(begin, nextEnd).join('')) + old.slice(end).join('')).replaceAll(']]>', ']]&gt;')
}

function readFields(xml: string, parent: XmlNode, fields: readonly string[]): View {
  const out: View = {}
  for (const key of fields) {
    const node = single(parent, key)
    const value = node && scalar(xml, node)
    if (value !== undefined) out[key] = value
  }
  return out
}

function element(tag: string, body: string): string {
  return `<${tag}>${body}</${tag}>`
}

function expand(xml: string, node: XmlNode, body: string): string {
  return xml.slice(node.start, node.openEnd - 2) + '>' + body + `</${node.name}>`
}

/** Compose direct-child splices against original offsets, never serialized XML. */
class Children {
  readonly replacements = new Map<XmlNode, string>()
  added = ''

  constructor(readonly xml: string, readonly tag: string, readonly node?: XmlNode) {}

  render(): string {
    const { xml, node, added } = this
    if (!node) return added ? element(this.tag, added) : ''
    if (!added && !this.replacements.size) return xml.slice(node.start, node.end)
    if (node.selfClosing) return expand(xml, node, added)
    if (added && !node.children.length) {
      const text = scalar(xml, node)?.replace(/\u2800/g, ' ').trim()
      if (text === undefined || !['', '∅', 'Ø', '—', '-'].includes(text)) throw new Error(`Cannot hide legacy text in ${node.name}`)
    }
    let pos = node.start
    let result = ''
    for (const child of node.children) {
      const value = this.replacements.get(child)
      if (value === undefined) continue
      result += xml.slice(pos, child.start) + value
      pos = child.end
    }
    return result + xml.slice(pos, node.closeStart) + added + xml.slice(node.closeStart, node.end)
  }
}

function writeFields(parent: Children, patch: unknown, allowed: readonly string[]): void {
  const fields = plainObject(patch, parent.tag)
  onlyKeys(fields, allowed, parent.tag)
  for (const [key, value] of Object.entries(fields)) {
    setLeaf(parent, single(parent.node, key), key, value)
  }
}

function setLeaf(parent: Children, node: XmlNode | undefined, key: string, raw: unknown): void {
  const label = `${parent.tag}.${key}`
  const value = plainText(raw, label)
  if (!node) { parent.added += element(key, escapeText(value)); return }
  if (node.children.length) throw new Error(`Non-scalar ${label}`)
  const xml = parent.xml
  const runs = textRuns(xml, node)
  const old = runs.map(r => r.value).join('')
  if (MARKUP.test(old)) throw new Error(`Opaque text in ${label}`)
  if (old === value) return
  if (node.selfClosing) { parent.replacements.set(node, expand(xml, node, escapeText(value))); return }

  // A comment/CDATA boundary belongs to the source. Only change a single run
  // if all other runs can remain exactly where they are, without guessing.
  let change: { start: number; end: number; body: string } | undefined
  let offset = 0
  for (const run of runs) {
    const before = old.slice(0, offset)
    offset += run.value.length
    const after = old.slice(offset)
    if (before.length + after.length > value.length || !value.startsWith(before) || !value.endsWith(after)) continue
    if (change) throw new Error(`Ambiguous annotated text in ${label}`)
    const part = value.slice(before.length, value.length - after.length)
    const body = run.cdata ? part.replace(/\]\]>/g, ']]]]><![CDATA[>') : replaceText(xml.slice(run.start, run.end), part)
    change = { start: run.start, end: run.end, body }
  }
  if (!runs.length) change = { start: node.closeStart, end: node.closeStart, body: escapeText(value) }
  if (!change) throw new Error(`Edit crosses an annotation in ${label}`)
  parent.replacements.set(node, xml.slice(node.start, change.start) + change.body + xml.slice(change.end, node.end))
}

type Named = (typeof RECORDS)[string]

const NAMED: Record<string, Named> = { ...RECORDS,
  reputation: { tag: 'ent_rep', identity: 'name', fields: ['score', 'standing', 'note', 'buff'] },
}
const LOCATION_TAGS = ['loc_rend', 'loc_load']
const LOCATION_FIELDS = ['name', 'map_id', 'dim', 'bbox', 'anchor', 'features', 'adj', 'grid', 'occupants', 'exits', 'updated']
const FIELDS = { ...SCALAR_FIELDS, ...SECTION_SCALAR_CHILDREN }

interface List { tag: string; group?: string }
function groups(names: readonly string[], tag: string): Record<string, List> {
  return Object.fromEntries(names.map(group => [group, { group, tag }]))
}
const LISTS: Record<string, Record<string, List>> = {
  tracks: { track: { tag: 'track' }, history: { tag: 'history' } },
  notebook: { ent: { tag: 'ent' }, note: { tag: 'note' } },
  leads: groups(SECTION_CONTAINERS.leads, 'lead'),
  chekhov: groups(SECTION_CONTAINERS.chekhov, 'bullet'),
}

export const ANALYZE_STATE_FORMAT = `statePatch: sparse JSON; omit unchanged keys ({} = no edit). Write nonblank strings, no markup, selectors, container replacements or deletions. Omit world.ct (turn counter).
Direct fields (read/write), e.g. {"world":{"user_pos":"By the bench"}}:
${Object.entries(FIELDS).map(([name, fields]) => `${name}: ${fields.join(' ')}`).join('\n')}
Named tables (read/write): exact identity key → changed fields, e.g. {"onscreen":{"Kris Lyons":{"residualMood":"shaken"}}}. New keys with fields add rows. Never trim/rename identities. dam keys A→B; pair keys A↔B.
${Object.entries(NAMED).filter(([name]) => name !== 'entityMem').map(([name, spec]) => `${name}: ${spec.fields.join(' ')}`).join('\n')}
locations: {"loc_rend":{"exact id":{"name":"North dock"}}}; loc_load same. Fields: ${LOCATION_FIELDS.join(' ')}.
Roster move: destination only, e.g. {"offscreen_agendas":{"Kris Lyons":{"$from":"onscreen","loc":"Inn"}}}; reverse with "$from":"offscreen_agendas". Source must exist, destination absent; moves carry the row.
entityMem: witness → string array; read all visible facts, write only new ones: {"entityMem":{"Ada":["Saw the ferry | T:dawn | V:sight | C:sure"]}}.
Lists read as arrays. Write an object per list: current 0-based index string → updated item, optional "append" → new items. Never send the array itself. Example: {"leads":{"active_leads":{"1":"Found Ada","append":["Check log"]}},"tracks":{"track":{"append":["Ferry | open"]}}}.
${Object.entries(LISTS).map(([name, lists]) => `${name} lists: ${Object.keys(lists).join(' ')}`).join('\n')}
Only present sections/fields are shown. Opaque legacy list slots are null (do not edit); other unmodeled content is retained privately.`

function identity(value: string | undefined, tag: string): string {
  const key = plainText(value, `${tag} identity`)
  if (['__proto__', 'constructor', 'prototype'].includes(key)) throw new Error(`Invalid identity in ${tag}`)
  return key
}

function indexRows(xml: string, parent: XmlNode | undefined, spec: Named): Map<string, XmlNode> {
  const rows = new Map<string, XmlNode>()
  for (const row of direct(parent, spec.tag)) {
    const id = single(row, spec.identity)
    const key = identity(id && scalar(xml, id), spec.tag)
    if (rows.has(key)) throw new Error(`Duplicate identity in ${spec.tag}`)
    rows.set(key, row)
  }
  return rows
}

function readNamed(xml: string, parent: XmlNode, spec: Named): View {
  const out: View = Object.create(null)
  for (const [key, row] of indexRows(xml, parent, spec)) {
    out[key] = spec === RECORDS.entityMem
      ? direct(row, 'mem').flatMap(node => scalar(xml, node) ?? [])
      : readFields(xml, row, spec.fields)
  }
  return out
}

function writeNamed(parent: Children, patch: unknown, spec: Named): void {
  const changes = plainObject(patch, parent.tag)
  const rows = indexRows(parent.xml, parent.node, spec)
  for (const [key, change] of Object.entries(changes)) {
    identity(key, spec.tag)
    const node = rows.get(key)
    const row = new Children(parent.xml, spec.tag, node)
    if (spec === RECORDS.entityMem) {
      const seen = new Set(direct(node, 'mem').map(n => scalar(parent.xml, n)))
      for (const item of jsonArray(change, 'entityMem')) {
        const fact = plainText(item, 'entityMem')
        if (seen.has(fact)) continue
        row.added += element('mem', escapeText(fact))
        seen.add(fact)
      }
    } else writeFields(row, change, spec.fields)
    finishRow(parent, row, spec, key)
  }
}

function finishRow(parent: Children, row: Children, spec: Named, key: string): void {
  if (row.node) parent.replacements.set(row.node, row.render())
  else if (row.added) {
    row.added = element(spec.identity, escapeText(key)) + row.added
    parent.added += row.render()
  }
}

const ROSTERS = ['onscreen', 'offscreen_agendas'] as const
type Roster = typeof ROSTERS[number]

/** Both rosters are resolved against the same original snapshot, even in a swap. */
function writeRosters(section: (name: string) => Children, changes: Record<string, unknown>): void {
  const table = (name: Roster) => {
    const root = section(name)
    return { root, spec: NAMED[name], rows: indexRows(root.xml, root.node, NAMED[name]),
      patch: Object.hasOwn(changes, name) ? plainObject(changes[name], name) : {} }
  }
  const tables = { onscreen: table('onscreen'), offscreen_agendas: table('offscreen_agendas') }
  for (const name of ROSTERS) {
    const other = name === 'onscreen' ? 'offscreen_agendas' : 'onscreen'
    const dest = tables[name], source = tables[other]
    for (const [key, raw] of Object.entries(dest.patch)) {
      identity(key, name)
      if (Object.hasOwn(source.patch, key)) throw new Error(`Conflicting roster edits for ${key}`)
      const patch = plainObject(raw, name)
      const from = source.rows.get(key), to = dest.rows.get(key)
      if (!Object.hasOwn(patch, '$from')) {
        if (from) throw new Error(`${key} already belongs to ${other}; use an explicit roster move`)
        const row = new Children(dest.root.xml, dest.spec.tag, to)
        writeFields(row, patch, dest.spec.fields)
        finishRow(dest.root, row, dest.spec, key)
        continue
      }
      const { $from, ...fields } = patch
      if ($from !== other || !from || to) throw new Error(`Invalid roster move to ${name} for ${key}`)
      const row = new Children(source.root.xml, dest.spec.tag, from)
      writeFields(row, fields, dest.spec.fields)
      // Retag only the opening/closing names; the row always contains an identity.
      const xml = row.render(), close = xml.lastIndexOf('</'), tag = dest.spec.tag
      dest.root.added += `<${tag}${xml.slice(from.name.length + 1, close)}</${tag}${xml.slice(close + 2 + from.name.length)}`
      source.root.replacements.set(from, '')
    }
  }
}

function readSection(xml: string, root: XmlNode, name: string): View {
  if (Object.hasOwn(NAMED, name)) return readNamed(xml, root, NAMED[name])
  if (name === 'locations') {
    const out: View = {}
    for (const tag of LOCATION_TAGS) {
      if (direct(root, tag).length) out[tag] = readNamed(xml, root, { tag, identity: 'id', fields: LOCATION_FIELDS })
    }
    return out
  }
  const out = readFields(xml, root, FIELDS[name] ?? [])
  for (const [key, { tag, group }] of Object.entries(LISTS[name] ?? {})) {
    const container = group ? single(root, group) : root
    const items = direct(container, tag)
    // Null, not filter(): opaque legacy items must not shift the model's indices.
    if (items.length || (group && container)) out[key] = items.map(item => scalar(xml, item) ?? null)
  }
  return out
}

function writeList(root: Children, spec: List, patch: unknown): void {
  const { group, tag } = spec
  const parent = group ? new Children(root.xml, group, single(root.node, group)) : root
  const changes = plainObject(patch, `${parent.tag}.${tag}`)
  const items = direct(parent.node, tag)
  for (const [key, value] of Object.entries(changes)) {
    if (key === 'append') {
      for (const item of jsonArray(value, `${tag} append`)) setLeaf(parent, undefined, tag, item)
    } else {
      if (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= items.length) throw new Error(`Invalid index ${key} in ${parent.tag}.${tag}`)
      setLeaf(parent, items[Number(key)], tag, value)
    }
  }
  if (group) {
    if (parent.node) root.replacements.set(parent.node, parent.render())
    else root.added += parent.render()
  }
}

function writeSection(root: Children, name: string, patch: unknown): void {
  if (Object.hasOwn(NAMED, name)) return writeNamed(root, patch, NAMED[name])
  const changes = plainObject(patch, name)
  if (name === 'locations') {
    onlyKeys(changes, LOCATION_TAGS, name)
    for (const [tag, value] of Object.entries(changes)) writeNamed(root, value, { tag, identity: 'id', fields: LOCATION_FIELDS })
    return
  }
  const lists = LISTS[name] ?? {}
  const fields = FIELDS[name] ?? []
  onlyKeys(changes, [...fields, ...Object.keys(lists)], name)
  for (const [key, value] of Object.entries(changes)) {
    if (Object.hasOwn(lists, key)) writeList(root, lists[key], value)
    else setLeaf(root, single(root.node, key), key, value)
  }
}

/** Sparse JSON view, not a serialization format for InternalState. */
export function projectAnalyzeState(current: InternalState): Record<string, View> {
  const { sections } = applyStateDelta(current, {})
  const out: Record<string, View> = {}
  for (const [name, xml] of Object.entries(sections)) {
    const node = sectionRoot(xml, name)
    out[name] = readSection(xml, node, name)
  }
  return out
}

/** Return the UI/RP state; a rejected patch never modifies the caller's copy. */
export function applyAnalyzeState(current: InternalState, patch: unknown): InternalState {
  const next = applyStateDelta(current, {})
  const changes = plainObject(patch, 'state patch')
  onlyKeys(changes, STATE_SECTIONS, 'state patch')
  const editors = new Map<string, Children>()
  const section = (name: string) => {
    const cached = editors.get(name)
    if (cached) return cached
    const xml = next.sections[name]
    const parent = new Children(xml ?? '', `state:${name}`, xml ? sectionRoot(xml, name) : undefined)
    editors.set(name, parent)
    return parent
  }
  if (ROSTERS.some(name => Object.hasOwn(changes, name))) writeRosters(section, changes)
  for (const [name, change] of Object.entries(changes)) {
    if (name !== 'onscreen' && name !== 'offscreen_agendas') writeSection(section(name), name, change)
  }
  for (const [name, parent] of editors) {
    const edited = parent.render()
    if (edited && edited !== parent.xml) {
      sectionRoot(edited, name)
      next.sections[name] = edited
    }
  }
  return next
}
