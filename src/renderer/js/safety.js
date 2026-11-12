// 連線對戰的安全功能：聊天髒話過濾（雙方送出、收到都會過濾），封鎖名單比對
// App Store 準則 1.2：使用者之間可以互傳內容時，要有過濾、檢舉、封鎖的方法

// 常見的髒話與人身攻擊字詞（會換成 ＊）。單字「幹」很常用（幹嘛、能幹），所以只濾整組罵人的說法。
const BAD = [
  '幹你娘', '幹您娘', '幹林娘', '幹你老師', '幹你媽', '幹恁娘', '操你媽', '操你娘', '操你', '肏你', '肏',
  '靠北', '靠杯', '靠腰', '雞掰', '機掰', '機車人', '他媽的', '他馬的', '你媽的', '媽的', '去死', '找死',
  '白痴', '白癡', '智障', '腦殘', '低能', '廢物', '垃圾人', '王八蛋', '混蛋', '賤人', '賤貨', '婊子', '屌',
  '傻逼', '傻屄', '煞筆', '妈的', '他妈的', '操你妈', '去你的',
  'fuck', 'fucking', 'fucker', 'motherfucker', 'shit', 'bitch', 'asshole', 'bastard', 'cunt', 'dick', 'pussy', 'slut', 'whore', 'nigger', 'retard',
];
const RE = new RegExp(BAD.sort((a, b) => b.length - a.length).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'gi');

/** 把髒話換成同樣長度的 ＊ */
export function filterText(s) {
  return String(s || '').replace(RE, (m) => '＊'.repeat([...m].length));
}

/** 封鎖名單裡有沒有這位棋友（比對暱稱，不分大小寫、去掉空白） */
export function isBlocked(list, name) {
  const n = String(name || '').replace(/\s+/g, '').toLowerCase();
  return !!n && (list || []).some((b) => String(b.name || b).replace(/\s+/g, '').toLowerCase() === n);
}
