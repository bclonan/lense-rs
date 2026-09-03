/** Original navigation symbols. These are not OSRS sprites or recognition templates. */
export interface OsrsVisualAsset {
  id: string
  src: string
  alt: string
  kind: 'reference-symbol'
  caption: string
  sourceUrl: string
  sourceTitle: string
  attribution: string
  recognitionNote: string
  width: 64
  height: 64
}

export const OSRS_SYMBOL_NOTICE = 'Reference symbol, not a game screenshot.'

function symbol(id: string, label: string, article: string): OsrsVisualAsset {
  return {
    id,
    src: `/osrs/icons/${id}.svg`,
    alt: `${label} reference symbol`,
    kind: 'reference-symbol',
    caption: OSRS_SYMBOL_NOTICE,
    sourceUrl: `https://oldschool.runescape.wiki/w/${article}`,
    sourceTitle: `OSRS Wiki: ${label} concept reference`,
    attribution: 'Original Lense artwork. No game image is embedded.',
    recognitionNote: 'Use this symbol to find the guide. Identify objects from a current screenshot, visible labels, and user-saved examples. This symbol does not establish a visual match.',
    width: 64,
    height: 64,
  }
}

export const OSRS_VISUAL_ASSETS: readonly OsrsVisualAsset[] = [
  symbol('axe', 'Axe', 'Axe'),
  symbol('pickaxe', 'Pickaxe', 'Pickaxe'),
  symbol('logs', 'Logs', 'Logs'),
  symbol('oak-logs', 'Oak logs', 'Oak_logs'),
  symbol('willow-logs', 'Willow logs', 'Willow_logs'),
  symbol('shrimp', 'Shrimps', 'Shrimps'),
  symbol('coins', 'Coins', 'Coins'),
  symbol('tinderbox', 'Tinderbox', 'Tinderbox'),
  symbol('fishing-net', 'Small fishing net', 'Small_fishing_net'),
  symbol('bank', 'Bank', 'Bank'),
  symbol('quest', 'Quest journal', 'Quest_List'),
  symbol('inventory', 'Inventory', 'Inventory'),
  symbol('tree', 'Tree', 'Tree'),
  symbol('compass', 'Compass', 'Compass'),
  symbol('health', 'Hitpoints', 'Hitpoints'),
  symbol('rock', 'Mining rock', 'Rocks'),
]

const byId = new Map(OSRS_VISUAL_ASSETS.map(asset => [asset.id, asset]))
const aliases: Readonly<Record<string, string>> = {
  'bronze-axe': 'axe',
  'bronze-pickaxe': 'pickaxe',
  'raw-shrimps': 'shrimp',
  shrimps: 'shrimp',
  'small-fishing-net': 'fishing-net',
}

export function getOsrsAsset(id: string): OsrsVisualAsset | undefined {
  return byId.get(aliases[id] ?? id)
}
