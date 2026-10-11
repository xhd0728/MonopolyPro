import type { CardDefinition, CharacterDefinition, MapDefinition, TileDefinition } from '../../shared/src/index.ts';

export const CHARACTERS: CharacterDefinition[] = [
  {id:'builder',name:'林小筑',title:'城市建筑师',description:'建设费用减少 15%。精打细算，把小屋变成地标。',ability:'每 3 轮领取 180 建设补助',color:'#eea65b',icon:'🏗'},
  {id:'landlord',name:'顾老板',title:'地产收藏家',description:'收取的租金增加 15%。街区连片，是你的财富密码。',ability:'每 3 轮领取 150 商业分红',color:'#cb8073',icon:'🏛'},
  {id:'runner',name:'陆飞飞',title:'城市漫游者',description:'每次掷骰额外前进 1 格。街头巷尾，都有你的足迹。',ability:'每 3 轮获得 1 次护盾和 80 现金',color:'#78afbd',icon:'🛵'},
  {id:'guardian',name:'苏安心',title:'风险管理师',description:'支付租金减少 15%。稳健经营，笑到最后。',ability:'每 3 轮获得 2 次租金护盾',color:'#7fa889',icon:'🛡'},
  {id:'dealer',name:'唐奇奇',title:'卡牌魔术师',description:'开局额外获得 1 张卡。用组合与时机改变牌局。',ability:'每 3 轮抽取 1 张卡',color:'#a894c6',icon:'🃏'},
  {id:'explorer',name:'白星星',title:'好运探险家',description:'事件现金奖励增加 25%。惊喜总在下一个路口。',ability:'每 3 轮领取 120 现金并解除停留',color:'#d4bc68',icon:'✦'}
];
const coords: [number,number][] = [];
for(let x=0;x<8;x++) coords.push([x,0]);
for(let z=1;z<7;z++) coords.push([7,z]);
for(let x=7;x>=0;x--) coords.push([x,7]);
for(let z=6;z>0;z--) coords.push([0,z]);
const names = ['晨光起点','梧桐公寓','花间书店','城市快讯','松果小巷','城市税务','橘子街','储蓄银行','青禾市集','云边旅社','奇遇广场','风铃车站','枫叶大道','百货公馆','卡牌商店','海棠里','白露茶馆','好运公园','湖畔新城','公共基金','星光会馆','安心医院','青石别院','银河商厦','街头新闻','时光车站','翡翠公寓','月光剧院'];
function makeMap(id:string,name:string,subtitle:string,description:string,theme:string,color:string,recommended:string,mechanic:MapDefinition['mechanic']): MapDefinition {
  const tiles: TileDefinition[] = coords.map(([x,z],index)=> {
    const kind = index===0?'start':index===7?'bank':index===14?'shop':index===21?'hospital':[3,10,17,24].includes(index)?'event':[5,19].includes(index)?'tax':mechanic==='ferry'&&[11,25].includes(index)?'transit':'property';
    const group=Math.floor(index/7),price=220+group*80+(index%3)*35;
    return {id:`${id}-${index}`,index,name:names[index],kind,x,z,group,price:kind==='property'?price:0,rent:Math.round(price*.16),buildCost:Math.round(price*.55),exits:[(index+1)%28]};
  });
  if(mechanic==='metro'){tiles[9].exits=[10,18];tiles[23].exits=[24,4];tiles[9].name='中央地铁';tiles[23].name='城市环线';}
  if(mechanic==='gates'){tiles[9].name='青龙机关';tiles[23].name='朱雀机关';}
  if(mechanic==='ferry'){tiles[11].name='海湾码头';tiles[25].name='灯塔码头';}
  return {id,name,subtitle,description,theme,color,recommended,mechanic,tiles};
}
export const MAPS: MapDefinition[] = [
  makeMap('town','晨光小镇','从第一块地，开始你的故事','明亮的小镇与完整环路，适合学习买地、升级、卡牌和现金管理。','town','#78a985','2–6 人 · 入门','none'),
  makeMap('islands','滨海群岛','乘着海风，驶向下一笔财富','两座码头提供可选轮渡捷径；支付 80 乘船，跨越半张棋盘。','islands','#76b6c2','2–6 人 · 路线策略','ferry'),
  makeMap('neon','霓虹都市','每个路口，都有新的机会','地铁连接两处内环捷径，岔路可以主动选择；交通不只由骰子决定。','neon','#9690c2','3–6 人 · 岔路博弈','metro'),
  makeMap('ancient','机关古城','城门开合，局势瞬息万变','机关每轮轮换：偶数轮开启跨城道路，奇数轮关闭，路线提前可见。','ancient','#c5a271','3–6 人 · 动态机关','gates')
];
function card(id:string,name:string,category:CardDefinition['category'],effect:CardDefinition['effect'],amount:number,target:CardDefinition['target'],description:string,icon:string): CardDefinition{return {id,name,category,effect,amount,target,description,icon,price:100+Math.abs(amount>6?Math.min(amount,400):amount*25)};}
export const CARDS: CardDefinition[] = [
  card('step','轻巧一步','move','move',1,'self','立即前进 1 格，并结算落点。','👟'),
  card('sprint','城市快跑','move','move',3,'self','立即前进 3 格，并结算落点。','🛵'),
  card('express','快线通行','move','move',6,'self','立即前进 6 格，并结算落点。','🚆'),
  card('home','回到晨光','move','teleport',0,'self','回到起点并领取 300 薪水。','🏠'),
  card('remote','遥控骰子','move','dice',0,'self','指定下一次骰子为 1–6 点，不叠加第二枚骰子。','🎲'),
  card('swap','位置交换','move','swap',0,'player','与一名对手交换位置；不触发落点结算。','↔'),
  card('bonus','意外奖金','economy','money',240,'self','立即获得 240 现金。','🎁'),
  card('grant','创业基金','economy','money',400,'self','立即获得 400 现金。','💼'),
  card('redpacket','红包接力','economy','steal',120,'player','从对手现金中收取至多 120，不会让其负债。','🧧'),
  card('savings','储蓄奖励','economy','deposit',300,'self','银行存款增加 300。','🏦'),
  card('interest','利息加倍','economy','interest',20,'self','获得存款的 20% 现金奖励，至少 80。','📈'),
  card('crowdfund','街区众筹','economy','collect',60,'self','向每名对手收取至多 60 现金。','🤝'),
  card('renovate','免费改造','build','upgrade',1,'ownProperty','一处未抵押地产免费升级 1 级，最高 3 级。','🏗'),
  card('coupon','建设折扣','build','discount',50,'self','下一次建设费用再减少 50%。','🎟'),
  card('demolish','拆迁计划','build','demolish',1,'enemyProperty','对手一处未受保护的建筑降低 1 级。','🔨'),
  card('festival','商业节庆','build','rentBoost',2,'ownProperty','一处地产的租金增加 50%，持续 2 轮。','🎪'),
  card('remoteBuy','远程购地','build','remoteBuy',0,'emptyProperty','按原价购买一处空地，无须站在地块上。','📜'),
  card('heritage','建筑保护','build','protect',3,'ownProperty','一处地产免受干扰卡影响，持续 3 轮。','🏰'),
  card('roadwork','道路施工','disrupt','trap',100,'tile','在地产上设置持续 3 轮的施工点，对手停靠支付 100。','🚧'),
  card('detour','临时停留','disrupt','skip',1,'player','让对手下一回合停留一次；不叠加超过 1 次。','⏳'),
  card('service','服务账单','disrupt','steal',200,'player','从对手现金中收取至多 200，不会让其负债。','🧾'),
  card('pickpocket','神秘换牌','disrupt','stealCard',1,'player','随机取走对手一张卡；其他玩家不会得知卡名。','🃏'),
  card('quiet','取消庆典','disrupt','clearBoost',0,'enemyProperty','取消对手地产的租金加成。','🔕'),
  card('rentCut','临时优惠','disrupt','rentCut',2,'enemyProperty','对手一处地产租金减少 50%，持续 2 轮。','✂'),
  card('shield','安心护盾','defense','shield',1,'self','免除下一次对手租金。','🛡'),
  card('doubleShield','双重保障','defense','shield',2,'self','免除接下来两次对手租金。','☂'),
  card('cleanse','清风拂面','defense','cleanse',0,'self','解除停留、移除自己所在地产的租金减益。','🍃'),
  card('rescue','自由通行','defense','rescue',0,'self','解除停留并获得 100 现金。','🔑'),
  card('insure','应急保险','defense','insure',150,'self','获得 150 现金和 1 次租金护盾。','🧰'),
  card('taxfree','税务减免','defense','taxShield',1,'self','免除下一次公共税费。','📋')
];
export const mapById = (id:string) => MAPS.find(m=>m.id===id) ?? MAPS[0];
export const characterById = (id:string) => CHARACTERS.find(c=>c.id===id) ?? CHARACTERS[0];
export const cardById = (id:string) => CARDS.find(c=>c.id===id);
export const CATEGORY_NAMES = {move:'移动',economy:'经济',build:'建设',disrupt:'干扰',defense:'防御'};
