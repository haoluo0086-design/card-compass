export const categories = [
  ['dining','餐饮 / 外卖'],['grocery','超市'],['onlineGrocery','线上超市'],
  ['gas','加油 / 充电'],['travelDirect','机票 / 酒店 / 租车直营'],['vacationRental','指定度假屋直营'],['transit','交通 / 停车'],
  ['streaming','指定流媒体'],['drugstore','药店'],['entertainment','娱乐'],
  ['superstore','Walmart / Target'],['wholesale','仓储会员店'],['other','其他消费'],
  ['chaseTravel','Chase Travel 预订'],['capitaloneTravel','Capital One Travel 酒店 / 租车 / 度假屋'],
  ['biltHotel','Bilt Travel 酒店'],['biltFlight','Bilt Travel 机票'],['lyft','Lyft'],
].map(([id,label])=>({id,label}));

export const defaultSettings = {
  pointValues:{chase:1,bilt:1,capitalone:1,cash:1},
  biltCategory:'dining',biltCashValue:0,biltGrocerySpent:0,biltGroceryYear:2026,
  biltMode:'unknown',biltRentDayEnabled:false,biltRentDayBonusUsed:0,biltRentDayMonth:'',
  enabledCards:['sapphire','freedom','obsidian','ventureone','savor'],
};
const ids = defaultSettings.enabledCards;
const finite = v => typeof v === 'number' && Number.isFinite(v);
const nonnegative = v => finite(v) && v >= 0;
const validDate = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
const normalize = s => String(s||'').normalize('NFKC').trim().toLocaleLowerCase();
const round = n => Math.round((n+Number.EPSILON)*100)/100;
const record = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const validMonth = s => typeof s === 'string' && /^\d{4}-\d{2}$/.test(s) && validDate(s+'-01');
const validHttpsUrl = s => {
  if(typeof s!=='string' || /[\u0000-\u0020\u007f]/.test(s)) return false;
  try { const u=new URL(s); return u.protocol==='https:' && !!u.hostname && !u.username && !u.password; }
  catch { return false; }
};
// Normalize punctuation in merchant descriptors, but do not match a brand
// inside an unrelated Latin word (for example Shell inside Seashell).
const merchantMatches = (merchant, name) => {
  const text=normalize(merchant).replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  const term=normalize(name).replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  if(!term) return false;
  const latinOrNumber=/[\p{Script=Latin}\p{N}]/u;
  let start=text.indexOf(term);
  while(start!==-1) {
    const end=start+term.length;
    const leftOK=!latinOrNumber.test(term[0]) || start===0 || text[start-1]===' ';
    const rightOK=!latinOrNumber.test(term.at(-1)) || end===text.length || text[end]===' ';
    if(leftOK && rightOK) return true;
    start=text.indexOf(term,start+1);
  }
  return false;
};

function checkedSettings(value) {
  const fail=()=>{throw new Error('无效设置');};
  if(!record(value) || (value.pointValues!==undefined && !record(value.pointValues))) fail();
  const p={...defaultSettings,...value};
  const pointValues={...defaultSettings.pointValues,...value.pointValues};
  if(!['chase','bilt','capitalone'].every(k=>nonnegative(pointValues[k])&&pointValues[k]<=20)) fail();
  if(!Array.isArray(p.enabledCards)||p.enabledCards.some(id=>!ids.includes(id))) fail();
  if(!['dining','grocery'].includes(p.biltCategory)||!['unknown','cash','housing'].includes(p.biltMode)) fail();
  if(!nonnegative(p.biltCashValue)||p.biltCashValue>1||!nonnegative(p.biltGrocerySpent)) fail();
  if(!Number.isInteger(p.biltGroceryYear)||p.biltGroceryYear<1||p.biltGroceryYear>9999) fail();
  if(typeof p.biltRentDayEnabled!=='boolean'||!nonnegative(p.biltRentDayBonusUsed)||p.biltRentDayBonusUsed>1000) fail();
  if(p.biltRentDayMonth!==''&&!validMonth(p.biltRentDayMonth)) fail();
  // Copy only recognized fields. Imported unknown keys never enter app state.
  return {
    pointValues:{chase:pointValues.chase,bilt:pointValues.bilt,capitalone:pointValues.capitalone,cash:1},
    biltCategory:p.biltCategory,biltCashValue:p.biltCashValue,biltGrocerySpent:p.biltGrocerySpent,
    biltGroceryYear:p.biltGroceryYear,biltMode:p.biltMode,biltRentDayEnabled:p.biltRentDayEnabled,
    biltRentDayBonusUsed:p.biltRentDayBonusUsed,biltRentDayMonth:p.biltRentDayMonth,
    enabledCards:[...new Set(p.enabledCards)],
  };
}

export function eligibleOffers(transaction, offers=[]) {
  if (!record(transaction) || !validDate(transaction.date) || !nonnegative(transaction.amount) || !Array.isArray(offers)) return [];
  return offers.filter(o => {
    if (!record(o) || o.activated!==true || o.used!==false || o.demo || !ids.includes(o.cardId)) return false;
    if (!validDate(o.expires) || (o.starts && !validDate(o.starts))) return false;
    if (transaction.date > o.expires || (o.starts && transaction.date < o.starts)) return false;
    if (typeof o.merchant!=='string' || typeof transaction.merchant!=='string' || !merchantMatches(transaction.merchant,o.merchant)) return false;
    if (o.category && o.category !== transaction.category) return false;
    if (!nonnegative(o.minSpend??0) || transaction.amount < (o.minSpend||0)) return false;
    if (!nonnegative(o.value) || (o.type!=='percent' && o.type!=='fixed')) return false;
    if (o.type==='percent' && o.value>100) return false;
    return o.cap==null || o.cap==='' || nonnegative(o.cap);
  });
}

export function recommend(transaction, settings=defaultSettings, offers=[], catalog) {
  if (!record(transaction) || !catalog || !Array.isArray(catalog.cards) || !finite(transaction.amount) || transaction.amount<=0 || transaction.amount>1e8 || !validDate(transaction.date)) return [];
  if (!categories.some(c=>c.id===transaction.category)) return [];
  let prefs;
  try { prefs=checkedSettings(settings); } catch { return []; }
  const amount=transaction.amount;
  const matching=eligibleOffers(transaction,offers);
  return catalog.cards.filter(c=>record(c)&&prefs.enabledCards.includes(c.id)).map(card=>{
    const reasons=[],warnings=[];
    let category=transaction.category;
    if (['grocery','onlineGrocery'].includes(category) && /\b(walmart|target|costco|sam.?s club)\b/i.test(transaction.merchant||'')) {
      category='other'; warnings.push('此商家可能是大卖场或仓储会员店，已保守按普通消费计算；以实际商户分类为准。');
    }
    const rule=(Array.isArray(card.rates)?card.rates:[]).find(r=>record(r) && r.category===category && nonnegative(r.multiplier) && (!r.starts || (validDate(r.starts)&&transaction.date>=r.starts)) && (!r.expires || (validDate(r.expires)&&transaction.date<=r.expires)));
    let rate=rule?.multiplier??card.baseRate??1;
    if(!nonnegative(rate)||!nonnegative(card.foreignFee??0)) return null;
    let points=amount*rate;
    if (card.id==='obsidian') {
      if (['dining','grocery','onlineGrocery'].includes(category)) {
        const chosen=category==='onlineGrocery'?'grocery':category;
        rate=chosen===prefs.biltCategory?3:1;
        points=amount*rate;
        if (chosen==='grocery' && rate===3) {
          const spent=Number(transaction.date.slice(0,4))===Number(prefs.biltGroceryYear) ? Math.max(0,Number(prefs.biltGrocerySpent)||0) : 0;
          const eligible=Math.min(amount,Math.max(0,25000-spent));
          points=eligible*3+(amount-eligible);
          rate=points/amount;
          if (eligible<amount) warnings.push('超市 3 倍积分受每年 $25,000 消费上限影响，超额部分按 1 倍。');
        }
      }
      if (prefs.biltRentDayEnabled && prefs.biltRentDayMonth===transaction.date.slice(0,7) && transaction.date>='2026-03-01' && transaction.date<='2027-01-01' && transaction.date.endsWith('-01')) {
        // Portal member bonuses do not double; only card-earned points do.
        const cardPoints=category==='biltHotel'?amount*2:category==='biltFlight'?amount*2:points;
        const bonus=Math.min(cardPoints,Math.max(0,1000-prefs.biltRentDayBonusUsed));
        points+=bonus; rate=points/amount;
        reasons.push(`已计入 Rent Day 奖励 ${Math.round(bonus)} 点（剩余额度与活动时间需确认）。`);
        warnings.push('Rent Day 按官方美国时区窗口，不能与 Points Accelerator 同时使用。');
      } else if(transaction.date.endsWith('-01') && transaction.date>='2026-03-01' && transaction.date<='2027-01-01') {
        warnings.push('Rent Day 可能适用；需确认该交易月份的活动时间及已用额度，跨月不会自动延续确认。');
      } else if(prefs.biltRentDayEnabled && transaction.date.endsWith('-01')) {
        warnings.push('该日期不在已核验的 Rent Day 活动期间内，未计入额外奖励。');
      }
      if(prefs.biltMode==='unknown') warnings.push('请在设置确认 Bilt 奖励模式和所选餐饮 / 超市类别。');
    }
    const valuation=card.currency==='cash'?1:Number(prefs.pointValues[card.currency]);
    if (!nonnegative(valuation)||valuation>20) return null;
    let baseValue=points*valuation/100;
    reasons.push(`${round(rate)} ${card.currency==='cash'?'% 现金回馈':`倍积分 × ${valuation} 美分/点`}`);
    if(card.id==='obsidian' && prefs.biltMode==='cash') {
      const fraction=Math.max(0,Math.min(1,Number(prefs.biltCashValue)||0));
      baseValue+=amount*.04*fraction;
      reasons.push(`4% Bilt Cash 按 ${Math.round(fraction*100)}% 可用价值计入；属于受限权益。`);
    }
    const valued=matching.filter(o=>o.cardId===card.id).map(o=>{
      const raw=o.type==='percent'?amount*o.value/100:o.value;
      const cap=o.cap==null||o.cap===''?Infinity:o.cap;
      return {...o,estimatedValue:Math.min(amount,raw,cap)};
    }).sort((a,b)=>b.estimatedValue-a.estimatedValue);
    // Without explicit stacking terms, never sum multiple statement-credit offers.
    const matchedOffers=valued.slice(0,1);
    const offerValue=matchedOffers[0]?.estimatedValue||0;
    if(matchedOffers.length) {
      reasons.push(`已激活优惠：${matchedOffers[0].title}`);
      warnings.push('商户名称匹配仅供核对；请确认门店、支付渠道及优惠完整条款。');
    }
    if(valued.length>1) warnings.push('多项优惠的叠加条件未确认，仅计入价值最高的一项。');
    const fee=transaction.foreign?amount*(card.foreignFee||0)/100:0;
    if(fee) warnings.push(`已扣除 ${card.foreignFee}% 境外交易费。`);
    if(category==='chaseTravel') warnings.push('酒店抵扣及点数支付部分可能不赚积分；请比较同一行程的实际总价。');
    if(['capitaloneTravel','biltHotel','biltFlight'].includes(category)) warnings.push('平台价格可能不同，请比较最终含税价。');
    if(['biltHotel','biltFlight'].includes(category)) warnings.push('仅比较卡片本身奖励；Bilt 平台会员奖励需按结账页确认，未单独加到任一张卡，避免偏向 Bilt 卡。');
    if(category==='vacationRental') warnings.push('指定度假屋类别仅适用于 Airbnb、Vrbo、Plum Guide、HomeAway、Homestay.com、Vacasa 直营；其他网站请选择其他消费。');
    if(category==='streaming') warnings.push('仅适用于各银行列明的流媒体服务；不确定时选择其他消费。');
    warnings.push('商户类别由银行识别；积分估值不是保证兑付金额。');
    return {cardId:card.id,total:round(baseValue+offerValue-fee),baseValue:round(baseValue),offerValue:round(offerValue),fee:round(fee),rate:round(rate),reasons,warnings,matchedOffers};
  }).filter(Boolean).sort((a,b)=>b.total-a.total || b.baseValue-a.baseValue);
}

export function validateBackup(payload) {
  const fail=()=>{throw new Error('备份格式或数值无效，请导入此应用导出的 JSON 文件。');};
  if(!record(payload)||payload.version!==1||!record(payload.settings)||!Array.isArray(payload.offers)||payload.offers.length>500) fail();
  const p=payload.settings;
  if(!record(p.pointValues)||!['chase','bilt','capitalone'].every(k=>nonnegative(p.pointValues[k])&&p.pointValues[k]<=20)) fail();
  let cleanSettings;
  try { cleanSettings=checkedSettings(p); } catch { fail(); }
  const seen=new Set();
  const offers=payload.offers.map(o=>{
    if(!record(o)||typeof o.id!=='string'||!o.id.trim()||o.id.length>200||seen.has(o.id)||!ids.includes(o.cardId)) fail(); seen.add(o.id);
    if(!['title','merchant'].every(k=>typeof o[k]==='string'&&o[k].trim()&&o[k].length<=200)) fail();
    if(!['percent','fixed'].includes(o.type)||!nonnegative(o.value)||o.value>1e6||(o.type==='percent'&&o.value>100)) fail();
    if(!nonnegative(o.minSpend??0)||(!(o.cap==null||o.cap==='')&&!nonnegative(o.cap))) fail();
    if(!validDate(o.expires)||(o.starts&&(!validDate(o.starts)||o.starts>o.expires))) fail();
    if(o.category&&!categories.some(c=>c.id===o.category)) fail();
    if(typeof o.activated!=='boolean'||typeof o.used!=='boolean') fail();
    if(o.url && !validHttpsUrl(o.url)) fail();
    return {id:o.id,cardId:o.cardId,title:o.title,merchant:o.merchant,category:o.category||'',type:o.type,value:o.value,minSpend:o.minSpend||0,cap:o.cap===''?null:o.cap,starts:o.starts||'',expires:o.expires,activated:o.activated,used:o.used,url:o.url||'',demo:!!o.demo};
  });
  return {version:1,settings:cleanSettings,offers};
}

export function makeCalendar(offer) {
  if(!offer||!validDate(offer.expires)) throw new Error('请先设置有效的优惠到期日。');
  const escape=s=>String(s||'').replace(/\\/g,'\\\\').replace(/\r\n|\r|\n/g,'\\n').replace(/;/g,'\\;').replace(/,/g,'\\,');
  const next=new Date(offer.expires+'T00:00:00Z'); next.setUTCDate(next.getUTCDate()+1);
  const date=offer.expires.replaceAll('-','');
  const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Card Compass//ZH','CALSCALE:GREGORIAN','BEGIN:VEVENT',`UID:${escape(offer.id||date)}@card-compass`,`DTSTAMP:${new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,'')}`,`DTSTART;VALUE=DATE:${date}`,`DTEND;VALUE=DATE:${next.toISOString().slice(0,10).replaceAll('-','')}`,`SUMMARY:${escape('优惠到期：'+offer.title)}`,`DESCRIPTION:${escape('请核对商户、激活状态及条款。 '+(offer.url||''))}`,'BEGIN:VALARM','ACTION:DISPLAY',`DESCRIPTION:${escape('优惠即将到期：'+offer.title)}`,'TRIGGER:-P1D','END:VALARM','END:VEVENT','END:VCALENDAR'];
  // Fold by UTF-8 octets without splitting Unicode characters (RFC 5545).
  return lines.map(line=>{let output='',row='',bytes=0;for(const ch of line){const size=new TextEncoder().encode(ch).length;if(bytes+size>74){output+=row+'\r\n';row=' ';bytes=1;}row+=ch;bytes+=size;}return output+row;}).join('\r\n')+'\r\n';
}
