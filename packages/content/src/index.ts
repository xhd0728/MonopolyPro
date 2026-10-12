import type {
  CardDefinition,
  DeckCardDefinition,
  NewsDefinition,
  CharacterDefinition,
  MapDefinition,
  TileDefinition,
} from '../../shared/src/index.ts';

export const CHARACTERS: CharacterDefinition[] = [
  {
    id: 'builder',
    name: '林小筑',
    title: '城市建筑师',
    description: '建设费用减少 15%。精打细算，把小屋变成地标。',
    ability: '每 3 轮领取 180 建设补助',
    color: '#eea65b',
    icon: '🏗',
  },
  {
    id: 'landlord',
    name: '顾老板',
    title: '地产收藏家',
    description: '收取的租金增加 15%。街区连片，是你的财富密码。',
    ability: '每 3 轮领取 150 商业分红',
    color: '#cb8073',
    icon: '🏛',
  },
  {
    id: 'runner',
    name: '陆飞飞',
    title: '城市漫游者',
    description: '每次掷骰额外前进 1 格。街头巷尾，都有你的足迹。',
    ability: '每 3 轮获得 1 次护盾和 80 现金',
    color: '#78afbd',
    icon: '🛵',
  },
  {
    id: 'guardian',
    name: '苏安心',
    title: '风险管理师',
    description: '支付租金减少 15%。稳健经营，笑到最后。',
    ability: '每 3 轮获得 2 次租金护盾',
    color: '#7fa889',
    icon: '🛡',
  },
  {
    id: 'dealer',
    name: '唐奇奇',
    title: '卡牌魔术师',
    description: '开局额外获得 1 张卡。用组合与时机改变牌局。',
    ability: '每 3 轮抽取 1 张卡',
    color: '#a894c6',
    icon: '🃏',
  },
  {
    id: 'explorer',
    name: '白星星',
    title: '好运探险家',
    description: '机会、命运卡的现金奖励增加 25%。惊喜总在下一个路口。',
    ability: '每 3 轮领取 120 现金，并解除停留或拘留',
    color: '#d4bc68',
    icon: '✦',
  },
];
/** Board geometry and corner rules shared by the engine, bots and client. */
export const BOARD = {
  side: 10,
  tiles: 36,
  start: 0,
  jail: 9,
  parking: 18,
  goToJail: 27,
  salary: 500,
  bail: 100,
  jailEscapeFace: 6,
  /** 猜一猜: reward per correct free guess, paid at most this many times a match. */
  guessReward: 30,
  guessCap: 5,
} as const;
/** Square sizes the host can pick: a 10x10 ring (36 squares) or a 12x12 ring (44). */
export const BOARD_SIZES = [36, 44] as const;
export type BoardSize = (typeof BOARD_SIZES)[number];
// Clockwise ring: top row left→right, right column down, bottom row right→left, left column up.
function ringCoords(side: number): [number, number][] {
  const out: [number, number][] = [];
  for (let x = 0; x < side; x++) out.push([x, 0]);
  for (let z = 1; z < side; z++) out.push([side - 1, z]);
  for (let x = side - 2; x >= 0; x--) out.push([x, side - 1]);
  for (let z = side - 2; z > 0; z--) out.push([0, z]);
  return out;
}
const COUNTRIES: Record<string, string> = {
  CN: '中国',
  JP: '日本',
  KR: '韩国',
  SG: '新加坡',
  TH: '泰国',
  VN: '越南',
  IN: '印度',
  MY: '马来西亚',
  ID: '印度尼西亚',
  PH: '菲律宾',
  LK: '斯里兰卡',
  NP: '尼泊尔',
  GB: '英国',
  FR: '法国',
  DE: '德国',
  IT: '意大利',
  ES: '西班牙',
  PT: '葡萄牙',
  GR: '希腊',
  NO: '挪威',
  SE: '瑞典',
  FI: '芬兰',
  DK: '丹麦',
  IS: '冰岛',
  NL: '荷兰',
  CH: '瑞士',
  AT: '奥地利',
  PL: '波兰',
  CZ: '捷克',
  HU: '匈牙利',
  IE: '爱尔兰',
  TR: '土耳其',
  GE: '格鲁吉亚',
  AZ: '阿塞拜疆',
  KZ: '哈萨克斯坦',
  UZ: '乌兹别克斯坦',
  KG: '吉尔吉斯斯坦',
  TM: '土库曼斯坦',
  AE: '阿联酋',
  OM: '阿曼',
  QA: '卡塔尔',
  SA: '沙特阿拉伯',
  JO: '约旦',
  IR: '伊朗',
  MN: '蒙古',
  US: '美国',
  CA: '加拿大',
  MX: '墨西哥',
  BR: '巴西',
  AR: '阿根廷',
  CL: '智利',
  PE: '秘鲁',
  CO: '哥伦比亚',
  CU: '古巴',
  JM: '牙买加',
  BS: '巴哈马',
  AU: '澳大利亚',
  NZ: '新西兰',
  FJ: '斐济',
  EG: '埃及',
  MA: '摩洛哥',
  ZA: '南非',
  KE: '肯尼亚',
  TZ: '坦桑尼亚',
  ET: '埃塞俄比亚',
  MG: '马达加斯加',
  MU: '毛里求斯',
  MV: '马尔代夫',
  BE: '比利时',
  LU: '卢森堡',
  MT: '马耳他',
  CY: '塞浦路斯',
  SK: '斯洛伐克',
  RO: '罗马尼亚',
  BG: '保加利亚',
  HR: '克罗地亚',
  PK: '巴基斯坦',
  BT: '不丹',
  BH: '巴林',
  KW: '科威特',
  LB: '黎巴嫩',
  TN: '突尼斯',
  DO: '多米尼加',
  PG: '巴布亚新几内亚',
  WS: '萨摩亚',
  TO: '汤加',
};
/** Board-label abbreviations for names longer than four characters. */
const SHORT_NAMES: Record<string, string> = {
  印度尼西亚: '印尼',
  吉尔吉斯斯坦: '吉尔吉斯',
  乌兹别克斯坦: '乌兹别克',
  土库曼斯坦: '土库曼',
  哈萨克斯坦: '哈萨克',
  埃塞俄比亚: '埃塞',
  沙特阿拉伯: '沙特',
  马达加斯加: '马岛',
  巴布亚新几内亚: '巴新',
};
export const shortCountryName = (name: string) => SHORT_NAMES[name] ?? name;
export const countryFlag = (code?: string) =>
  code ? [...code].map((c) => String.fromCodePoint(127397 + c.charCodeAt(0))).join('') : '';
// Countries in route order. Every three consecutive countries form one colour group.
const countryRoutes: Record<string, string[]> = {
  town: [
    ...['CN', 'JP', 'KR'],
    ...['SG', 'TH', 'VN'],
    ...['GB', 'FR', 'DE'],
    ...['IT', 'ES', 'NL'],
    ...['US', 'CA', 'MX'],
    ...['BR', 'AR', 'CL'],
    ...['EG', 'MA', 'ZA'],
    ...['AU', 'NZ', 'FJ'],
  ],
  // Two ports replace one country on the second and fourth sides: 22 countries.
  islands: [
    ...['JP', 'PH', 'ID', 'SG', 'MY', 'LK'],
    ...['GB', 'IE', 'IS', 'NO', 'DK'],
    ...['PT', 'GR', 'CU', 'JM', 'BS', 'CA'],
    ...['CL', 'PE', 'AU', 'NZ', 'FJ'],
  ],
  neon: [
    ...['CN', 'JP', 'KR'],
    ...['TH', 'SG', 'MY'],
    ...['DE', 'FR', 'NL'],
    ...['CH', 'AT', 'IT'],
    ...['ES', 'PT', 'GR'],
    ...['TR', 'PL', 'CZ'],
    ...['HU', 'SE', 'FI'],
    ...['NO', 'DK', 'IS'],
  ],
  ancient: [
    ...['CN', 'MN', 'KG'],
    ...['KZ', 'UZ', 'TM'],
    ...['IN', 'NP', 'LK'],
    ...['IR', 'AZ', 'GE'],
    ...['TR', 'JO', 'SA'],
    ...['AE', 'OM', 'QA'],
    ...['EG', 'ET', 'KE'],
    ...['TZ', 'MG', 'ZA'],
  ],
};
// The 44-square boards: eight colour groups of four countries (the ferry map has two ports).
const countryRoutesXL: Record<string, string[]> = {
  town: [
    ...['CN', 'JP', 'KR', 'MN'],
    ...['SG', 'TH', 'VN', 'MY'],
    ...['GB', 'FR', 'DE', 'BE'],
    ...['IT', 'ES', 'PT', 'NL'],
    ...['US', 'CA', 'MX', 'CU'],
    ...['BR', 'AR', 'CL', 'PE'],
    ...['EG', 'MA', 'KE', 'ZA'],
    ...['AU', 'NZ', 'FJ', 'PG'],
  ],
  islands: [
    ...['JP', 'PH', 'ID', 'SG', 'MY', 'LK', 'MV', 'GB'],
    ...['IE', 'IS', 'NO', 'DK', 'PT', 'GR', 'MT', 'CY'],
    ...['CU', 'JM', 'BS', 'DO', 'CA', 'CL', 'PE'],
    ...['AU', 'NZ', 'FJ', 'PG', 'WS', 'TO', 'MG'],
  ],
  neon: [
    ...['CN', 'JP', 'KR', 'MN'],
    ...['TH', 'SG', 'MY', 'KZ'],
    ...['DE', 'FR', 'NL', 'BE'],
    ...['CH', 'AT', 'IT', 'LU'],
    ...['ES', 'PT', 'GR', 'MT'],
    ...['TR', 'PL', 'CZ', 'SK'],
    ...['HU', 'RO', 'BG', 'HR'],
    ...['SE', 'FI', 'NO', 'DK'],
  ],
  ancient: [
    ...['CN', 'MN', 'KG', 'KZ'],
    ...['UZ', 'TM', 'PK', 'IN'],
    ...['NP', 'BT', 'LK', 'IR'],
    ...['AZ', 'GE', 'TR', 'JO'],
    ...['SA', 'AE', 'OM', 'QA'],
    ...['BH', 'KW', 'LB', 'EG'],
    ...['TN', 'MA', 'ET', 'KE'],
    ...['TZ', 'MG', 'ZA', 'CY'],
  ],
};
const specialNames: Partial<Record<TileDefinition['kind'], string>> = {
  start: '环球起点',
  bank: '国际银行',
  shop: '卡牌市场',
  jail: '海关拘留所',
  parking: '免费停车场',
  gotojail: '海关遣返',
  tax: '公共税务',
  chance: '机会',
  fate: '命运',
  transit: '跨洋港口',
};
/** Kinds of the two special squares on each side, in side order. */
const SIDE_KINDS: [TileDefinition['kind'], TileDefinition['kind']][] = [
  ['chance', 'tax'],
  ['bank', 'fate'],
  ['chance', 'shop'],
  ['tax', 'fate'],
];
/**
 * Where things sit on a ring of `side` squares per edge: the two specials per side, the ferry
 * ports (middle of the second and fourth sides) and the fork / gate shortcuts. Offsets are counted
 * from each side's first corner, so 36- and 44-square boards share one layout logic.
 */
function layoutFor(side: number) {
  const edge = side - 1;
  const specials = side === 10 ? [3, 6] : [3, 8];
  const port = side === 10 ? 4 : 5;
  const fork = 2,
    landing = side === 10 ? 5 : 6;
  return {
    edge,
    corners: { start: 0, jail: edge, parking: edge * 2, goToJail: edge * 3 },
    specials: Object.fromEntries(
      SIDE_KINDS.flatMap(([a, b], k) => [
        [k * edge + specials[0], a],
        [k * edge + specials[1], b],
      ]),
    ) as Record<number, TileDefinition['kind']>,
    shortcuts: {
      none: [] as [number, number][],
      ferry: [[edge + port, edge * 3 + port]] as [number, number][],
      metro: [
        [edge + fork, edge * 2 + landing],
        [edge * 3 + fork, landing],
      ] as [number, number][],
      gates: [
        [edge + fork, edge * 2 + landing - 1],
        [edge * 3 + fork, landing - 1],
      ] as [number, number][],
    },
  };
}
interface MapInfo {
  id: string;
  name: string;
  subtitle: string;
  description: (squares: number, countries: number) => string;
  color: string;
  recommended: string;
  mechanic: MapDefinition['mechanic'];
}
function makeMap(info: MapInfo, size: BoardSize): MapDefinition {
  const side = size / 4 + 1;
  const { edge, corners, specials, shortcuts: all } = layoutFor(side);
  const coords = ringCoords(side);
  const shortcuts = all[info.mechanic];
  const ports = info.mechanic === 'ferry' ? shortcuts[0] : [];
  const cornerKinds: Record<number, TileDefinition['kind']> = {
    [corners.start]: 'start',
    [corners.jail]: 'jail',
    [corners.parking]: 'parking',
    [corners.goToJail]: 'gotojail',
  };
  const kinds = coords.map(
    (_, index): TileDefinition['kind'] =>
      cornerKinds[index] ??
      specials[index] ??
      ((ports as number[]).includes(index) ? 'transit' : 'property'),
  );
  // Two colour groups per side: the first half of a side's countries, then the second half.
  const groupOf: number[] = [];
  for (let k = 0; k < 4; k++) {
    const lots = kinds
      .map((kind, index) => ({ kind, index }))
      .filter((t) => t.kind === 'property' && Math.floor(t.index / edge) === k && t.index % edge);
    lots.forEach((t, n) => (groupOf[t.index] = k * 2 + (n < Math.ceil(lots.length / 2) ? 0 : 1)));
  }
  // Prices climb along the route; the large board spreads them a little wider.
  const groupStep = size === 36 ? 45 : 60,
    lotStep = size === 36 ? 20 : 15;
  const route = (size === 36 ? countryRoutes : countryRoutesXL)[info.id];
  const rank: number[] = [];
  let countryIndex = 0;
  const tiles: TileDefinition[] = coords.map(([x, z], index) => {
    const kind = kinds[index];
    const group = kind === 'property' ? groupOf[index] : Math.floor(index / edge) * 2;
    const step = kind === 'property' ? (rank[group] = (rank[group] ?? -1) + 1) : 0;
    const price = kind === 'property' ? 200 + group * groupStep + step * lotStep : 0;
    const countryCode = kind === 'property' ? route[countryIndex++] : undefined;
    return {
      id: `${info.id}-${size}-${index}`,
      index,
      name: countryCode ? COUNTRIES[countryCode] : specialNames[kind]!,
      kind,
      ...(countryCode ? { countryCode } : {}),
      x,
      z,
      group,
      price,
      rent: Math.round(price * 0.14),
      buildCost: Math.round(price * 0.55),
      exits: [(index + 1) % size],
    };
  });
  if (info.mechanic === 'metro')
    for (const [from, to] of shortcuts) tiles[from].exits = [from + 1, to];
  if (info.mechanic === 'ferry') {
    tiles[ports[0]].name = '东洋港口';
    tiles[ports[1]].name = '西洋港口';
  }
  const countries = tiles.filter((t) => t.kind === 'property').length;
  return {
    id: info.id,
    name: info.name,
    subtitle: info.subtitle,
    description: info.description(size, countries),
    theme: info.id,
    color: info.color,
    recommended: info.recommended,
    mechanic: info.mechanic,
    side,
    corners,
    // A lap of the larger ring takes longer, so passing start pays more.
    salary: size === 36 ? BOARD.salary : 600,
    shortcuts,
    tiles,
  };
}
const MAP_INFO: MapInfo[] = [
  {
    id: 'town',
    name: '世界环游',
    subtitle: '从亚洲出发，经营全球旅程',
    description: (n, c) =>
      `沿 ${n} 格环线游历 ${c} 个国家、8 个地产组。四角是起点、拘留所、免费停车与遣返，适合第一场对局。`,
    color: '#78a985',
    recommended: '2–6 人 · 入门',
    mechanic: 'none',
  },
  {
    id: 'islands',
    name: '海洋航线',
    subtitle: '连接海岸与岛屿的财富航线',
    description: (n, c) =>
      `${n} 格航线上的 ${c} 个海洋与海岸国家。两座港口提供轮渡捷径，船票 80，直达对岸半张棋盘。`,
    color: '#76b6c2',
    recommended: '2–6 人 · 路线策略',
    mechanic: 'ferry',
  },
  {
    id: 'neon',
    name: '欧亚快线',
    subtitle: '穿行欧亚，选择自己的路线',
    description: (n, c) =>
      `${n} 格、${c} 个欧亚国家与两条国际快线。抵达岔路时主动选路，跳过半圈但可能错过起点薪水。`,
    color: '#9690c2',
    recommended: '3–6 人 · 岔路博弈',
    mechanic: 'metro',
  },
  {
    id: 'ancient',
    name: '丝路商旅',
    subtitle: '沿商路跨洲，抓住通行窗口',
    description: (n, c) =>
      `${n} 格商路连接 ${c} 个亚洲与非洲国家。商路偶数轮开放、奇数轮关闭，提前规划每次跨洲通行。`,
    color: '#c5a271',
    recommended: '3–6 人 · 动态机关',
    mechanic: 'gates',
  },
];
/** Standard 36-square maps (the default). */
export const MAPS: MapDefinition[] = MAP_INFO.map((info) => makeMap(info, 36));
/** Large 44-square maps. */
export const MAPS_XL: MapDefinition[] = MAP_INFO.map((info) => makeMap(info, 44));
function card(
  id: string,
  name: string,
  category: CardDefinition['category'],
  effect: CardDefinition['effect'],
  amount: number,
  target: CardDefinition['target'],
  description: string,
  icon: string,
): CardDefinition {
  return {
    id,
    name,
    category,
    effect,
    amount,
    target,
    description,
    icon,
    price: 100 + Math.abs(amount > 6 ? Math.min(amount, 400) : amount * 25),
  };
}
export const CARDS: CardDefinition[] = [
  card('step', '轻巧一步', 'move', 'move', 1, 'self', '立即前进 1 格，并结算落点。', '👟'),
  card('sprint', '城市快跑', 'move', 'move', 3, 'self', '立即前进 3 格，并结算落点。', '🛵'),
  card('express', '快线通行', 'move', 'move', 6, 'self', '立即前进 6 格，并结算落点。', '🚆'),
  card(
    'home',
    '回到起点',
    'move',
    'teleport',
    0,
    'self',
    `回到起点并领取 ${BOARD.salary} 薪水。`,
    '🏠',
  ),
  card('remote', '遥控骰子', 'move', 'dice', 0, 'self', '指定下一次掷骰的点数为 1–6。', '🎲'),
  card(
    'swap',
    '位置交换',
    'move',
    'swap',
    0,
    'player',
    '与一名对手交换位置；不触发落点结算。',
    '↔',
  ),
  card('bonus', '意外奖金', 'economy', 'money', 240, 'self', '立即获得 240 现金。', '🎁'),
  card('grant', '创业基金', 'economy', 'money', 400, 'self', '立即获得 400 现金。', '💼'),
  card(
    'redpacket',
    '红包接力',
    'economy',
    'steal',
    120,
    'player',
    '从对手现金中收取至多 120，不会让其负债。',
    '🧧',
  ),
  card('savings', '储蓄奖励', 'economy', 'deposit', 300, 'self', '银行存款增加 300。', '🏦'),
  card(
    'interest',
    '利息加倍',
    'economy',
    'interest',
    20,
    'self',
    '获得存款的 20% 现金奖励，至少 80。',
    '📈',
  ),
  card(
    'crowdfund',
    '街区众筹',
    'economy',
    'collect',
    60,
    'self',
    '向每名对手收取至多 60 现金。',
    '🤝',
  ),
  card(
    'renovate',
    '免费改造',
    'build',
    'upgrade',
    1,
    'ownProperty',
    '一处未抵押地产免费升级 1 级，最高 3 级。',
    '🏗',
  ),
  card('coupon', '建设折扣', 'build', 'discount', 50, 'self', '下一次建设费用再减少 50%。', '🎟'),
  card(
    'demolish',
    '拆迁计划',
    'build',
    'demolish',
    1,
    'enemyProperty',
    '对手一处未受保护的建筑降低 1 级。',
    '🔨',
  ),
  card(
    'festival',
    '商业节庆',
    'build',
    'rentBoost',
    2,
    'ownProperty',
    '一处地产的租金增加 50%，持续 2 轮。',
    '🎪',
  ),
  card(
    'remoteBuy',
    '远程购地',
    'build',
    'remoteBuy',
    0,
    'emptyProperty',
    '按原价购买一处空地，无须站在地块上。',
    '📜',
  ),
  card(
    'heritage',
    '建筑保护',
    'build',
    'protect',
    3,
    'ownProperty',
    '一处地产免受干扰卡影响，持续 3 轮。',
    '🏰',
  ),
  card(
    'roadwork',
    '道路施工',
    'disrupt',
    'trap',
    100,
    'tile',
    '在地产上设置持续 3 轮的施工点，对手停靠支付 100。',
    '🚧',
  ),
  card(
    'detour',
    '临时停留',
    'disrupt',
    'skip',
    1,
    'player',
    '让对手下一回合停留一次；不叠加超过 1 次。',
    '⏳',
  ),
  card(
    'service',
    '服务账单',
    'disrupt',
    'steal',
    200,
    'player',
    '从对手现金中收取至多 200，不会让其负债。',
    '🧾',
  ),
  card(
    'pickpocket',
    '神秘换牌',
    'disrupt',
    'stealCard',
    1,
    'player',
    '随机取走对手一张卡；其他玩家不会得知卡名。',
    '🃏',
  ),
  card(
    'quiet',
    '取消庆典',
    'disrupt',
    'clearBoost',
    0,
    'enemyProperty',
    '取消对手地产的租金加成。',
    '🔕',
  ),
  card(
    'rentCut',
    '临时优惠',
    'disrupt',
    'rentCut',
    2,
    'enemyProperty',
    '对手一处地产租金减少 50%，持续 2 轮。',
    '✂',
  ),
  card('shield', '安心护盾', 'defense', 'shield', 1, 'self', '免除下一次对手租金。', '🛡'),
  card('doubleShield', '双重保障', 'defense', 'shield', 2, 'self', '免除接下来两次对手租金。', '☂'),
  card(
    'cleanse',
    '清风拂面',
    'defense',
    'cleanse',
    0,
    'self',
    '解除停留、移除自己所有地产的租金减益。',
    '🍃',
  ),
  card(
    'rescue',
    '自由通行',
    'defense',
    'rescue',
    0,
    'self',
    '立即离开拘留所或解除停留，并获得 100 现金。',
    '🔑',
  ),
  card(
    'insure',
    '应急保险',
    'defense',
    'insure',
    150,
    'self',
    '获得 150 现金和 1 次租金护盾。',
    '🧰',
  ),
  card('taxfree', '税务减免', 'defense', 'taxShield', 1, 'self', '免除下一次公共税费。', '📋'),
];
export const mapById = (id: string, size: number = 36) => {
  const list = size === 44 ? MAPS_XL : MAPS;
  return list.find((m) => m.id === id) ?? list[0];
};
export const characterById = (id: string) => CHARACTERS.find((c) => c.id === id) ?? CHARACTERS[0];
export const cardById = (id: string) => CARDS.find((c) => c.id === id);
export const CATEGORY_NAMES = {
  move: '移动',
  economy: '经济',
  build: '建设',
  disrupt: '干扰',
  defense: '防御',
};

const deckCard = (
  deck: DeckCardDefinition['deck'],
  id: string,
  name: string,
  icon: string,
  effect: DeckCardDefinition['effect'],
  amount: number,
  value: number,
  text: string,
  target?: DeckCardDefinition['target'],
): DeckCardDefinition => ({
  id: `${deck}-${id}`,
  deck,
  name,
  icon,
  effect,
  amount,
  value,
  text,
  ...(target !== undefined ? { target } : {}),
});
/** 机会：movement surprises and bold swings. Sixteen cards, like the classic Chance deck. */
export const CHANCE_CARDS: DeckCardDefinition[] = [
  deckCard(
    'chance',
    'start',
    '直飞起点',
    '✈️',
    'advanceTo',
    0,
    5,
    `前往起点，领取 ${BOARD.salary} 薪水。`,
    'start',
  ),
  deckCard(
    'chance',
    'parking',
    '停车场直通车',
    '🚌',
    'advanceTo',
    0,
    4,
    '前往免费停车场并领取奖池；途经起点照常领薪水。',
    'parking',
  ),
  deckCard(
    'chance',
    'priciest',
    '豪华环游',
    '🛳️',
    'advanceTo',
    0,
    1,
    '前往本图地价最高的国家；无人拥有可以购买，否则照付租金。',
    'priciest',
  ),
  deckCard(
    'chance',
    'frontier',
    '寻找新大陆',
    '🧭',
    'advanceTo',
    100,
    4,
    '前进到下一处无人拥有的国家，可以购买；没有空地则获得 100。',
    'nearestEmpty',
  ),
  deckCard('chance', 'headwind', '逆风', '🌬️', 'move', -3, 2, '后退 3 格，并处理落点。'),
  deckCard('chance', 'tailwind', '顺风', '🪁', 'move', 3, 3, '前进 3 格，并处理落点。'),
  deckCard(
    'chance',
    'passport',
    '护照过期',
    '🛂',
    'jail',
    0,
    0,
    '直接前往拘留所，不经过起点、不领薪水。',
  ),
  deckCard(
    'chance',
    'immunity',
    '外交豁免',
    '🗝️',
    'jailCard',
    100,
    4,
    '获得一张「自由通行」，可在拘留时使用；手牌已满则获得 100。',
  ),
  deckCard('chance', 'dividend', '银行分红', '🏦', 'gain', 150, 4, '获得 150。'),
  deckCard('chance', 'speeding', '超速罚单', '🚓', 'pay', 60, 1, '支付 60，进入停车场奖池。'),
  deckCard(
    'chance',
    'renovation',
    '城市翻新',
    '🧱',
    'repairs',
    40,
    1,
    '每 1 级建筑支付 40，进入停车场奖池。',
  ),
  deckCard('chance', 'chairman', '当选旅行团长', '🎖️', 'payEach', 50, 0, '向每位对手支付 50。'),
  deckCard('chance', 'maturity', '投资到期', '📈', 'gain', 250, 5, '获得 250。'),
  deckCard(
    'chance',
    'makeover',
    '免费装修',
    '🛠️',
    'upgradeRandom',
    150,
    5,
    '随机一处自己未抵押、未满级的地产免费升 1 级；没有则获得 150。',
  ),
  deckCard('chance', 'gift', '神秘礼物', '🎁', 'drawCard', 0, 3, '抽一张手牌；手牌已满则获得 80。'),
  deckCard('chance', 'insurance', '旅行保险', '☂️', 'shield', 0, 3, '获得 1 次租金护盾。'),
];
/** 命运：money, neighbours and the whole table. Sixteen cards, like Community Chest. */
export const FATE_CARDS: DeckCardDefinition[] = [
  deckCard('fate', 'bank-error', '银行出错', '🧾', 'gain', 200, 5, '银行算错账，获得 200。'),
  deckCard('fate', 'checkup', '体检费', '🩺', 'pay', 50, 1, '支付 50，进入停车场奖池。'),
  deckCard(
    'fate',
    'birthday',
    '生日派对',
    '🎂',
    'collectEach',
    25,
    4,
    '每位对手送你 25（现金不足则尽力而为）。',
  ),
  deckCard('fate', 'bonus', '年终奖', '🧧', 'gain', 100, 3, '获得 100。'),
  deckCard('fate', 'tuition', '进修学费', '🎓', 'pay', 80, 1, '支付 80，进入停车场奖池。'),
  deckCard('fate', 'inherit', '远亲遗产', '📜', 'gain', 120, 3, '获得 120。'),
  deckCard(
    'fate',
    'noise',
    '深夜派对',
    '📢',
    'jail',
    0,
    0,
    '邻居报警，直接前往拘留所，不经过起点。',
  ),
  deckCard(
    'fate',
    'kitten',
    '救助流浪猫',
    '🐈',
    'jailCard',
    100,
    4,
    '好人有好报：获得一张「自由通行」；手牌已满则获得 100。',
  ),
  deckCard(
    'fate',
    'street',
    '街道维修',
    '🚧',
    'repairs',
    30,
    1,
    '每 1 级建筑支付 30，进入停车场奖池。',
  ),
  deckCard('fate', 'photo', '旅行摄影奖', '📷', 'gain', 80, 2, '获得 80。'),
  deckCard(
    'fate',
    'relay',
    '爱心接力',
    '🤝',
    'robinHood',
    100,
    3,
    '现金最多的玩家给现金最少的玩家 100（是同一人则无事发生）。',
  ),
  deckCard('fate', 'claim', '保险理赔', '🧰', 'shield', 50, 3, '获得 50 和 1 次租金护盾。'),
  deckCard('fate', 'jackpot', '奖池分红', '🎰', 'potHalf', 0, 3, '领取停车场奖池的一半。'),
  deckCard(
    'fate',
    'home',
    '回家过年',
    '🏮',
    'advanceTo',
    0,
    5,
    `前往起点，领取 ${BOARD.salary} 薪水。`,
    'start',
  ),
  deckCard('fate', 'feast', '街区聚餐', '🥟', 'everyone', 60, 3, '所有仍在经营的玩家各获得 60。'),
  deckCard('fate', 'gala', '慈善晚宴', '🎻', 'pay', 100, 0, '支付 100，进入停车场奖池。'),
];
export const DECK_CARDS = [...CHANCE_CARDS, ...FATE_CARDS];
export const deckCardById = (id: string) => DECK_CARDS.find((c) => c.id === id);
/** 世界新闻: one flips at the start of every round and lasts for that round. */
export const NEWS: NewsDefinition[] = [
  {
    id: 'calm',
    name: '风平浪静',
    icon: '🌤️',
    effect: 'calm',
    amount: 0,
    text: '本轮没有特别新闻，按常规经营。',
  },
  {
    id: 'boom',
    name: '旅游旺季',
    icon: '🔥',
    effect: 'groupBoom',
    amount: 50,
    text: '本轮一组国家租金 +50%。',
  },
  {
    id: 'slump',
    name: '旅游淡季',
    icon: '🌧️',
    effect: 'groupSlump',
    amount: 40,
    text: '本轮一组国家租金 −40%。',
  },
  {
    id: 'rate-cut',
    name: '央行降息',
    icon: '📉',
    effect: 'rateCut',
    amount: 0,
    text: '本轮结束时存款不计利息。',
  },
  {
    id: 'rate-hike',
    name: '央行加息',
    icon: '📈',
    effect: 'rateHike',
    amount: 6,
    text: '本轮结束时存款利息提高到 6%。',
  },
  {
    id: 'build-sale',
    name: '建材降价',
    icon: '🧱',
    effect: 'buildSale',
    amount: 30,
    text: '本轮建设费用 −30%。',
  },
  {
    id: 'tax-holiday',
    name: '税务假期',
    icon: '🏖️',
    effect: 'taxHoliday',
    amount: 0,
    text: '本轮停在税务格免税。',
  },
  {
    id: 'land-rush',
    name: '地价上涨',
    icon: '🏗️',
    effect: 'landRush',
    amount: 20,
    text: '本轮购买空地价格 +20%。',
  },
  {
    id: 'land-sale',
    name: '地产促销',
    icon: '🏷️',
    effect: 'landSale',
    amount: 20,
    text: '本轮购买空地价格 −20%。',
  },
  {
    id: 'payday',
    name: '薪水节',
    icon: '💰',
    effect: 'doubleSalary',
    amount: 2,
    text: '本轮经过起点领取双倍薪水。',
  },
  {
    id: 'customs',
    name: '海关严查',
    icon: '🛃',
    effect: 'strictCustoms',
    amount: 2,
    text: '本轮拘留所保释金翻倍。',
  },
  {
    id: 'festival',
    name: '环球庆典',
    icon: '🎉',
    effect: 'festival',
    amount: 100,
    text: '所有仍在经营的玩家立即获得 100。',
  },
  {
    id: 'wealth-tax',
    name: '富豪税',
    icon: '🏛️',
    effect: 'wealthTax',
    amount: 8,
    text: '净资产最高的玩家缴纳现金的 8%（最多 300）进入停车场奖池。',
  },
  {
    id: 'lucky',
    name: '幸运日',
    icon: '🍀',
    effect: 'luckyDraw',
    amount: 50,
    text: '本轮每次抽机会或命运卡额外获得 50。',
  },
];
export const newsById = (id: string) => NEWS.find((n) => n.id === id);
