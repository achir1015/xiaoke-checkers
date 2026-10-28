#!/bin/bash
# 把手機版網頁（先在專案根目錄執行 node scripts/build-mobile.mjs 產生 mobile/www）
# 複製到 ios/web，版本號跟著 package.json，再產生 Xcode 專案。在 Mac 上執行：bash ios/sync.sh
set -e
cd "$(dirname "$0")"
[ -f ../mobile/www/index.html ] || { echo "找不到 ../mobile/www，請先執行 node scripts/build-mobile.mjs"; exit 1; }
rm -rf web && cp -R ../mobile/www web
V=$(python3 -c 'import json;print(json.load(open("../package.json"))["version"])')
# 版本號：1.5.0 → build 10500（每次送審都要比上一次大）
B=$(python3 -c "a,b,c=(int(x) for x in '$V'.split('.'));print(a*10000+b*100+c)")
sed -i '' "s/MARKETING_VERSION: \".*\"/MARKETING_VERSION: \"$V\"/; s/CURRENT_PROJECT_VERSION: \".*\"/CURRENT_PROJECT_VERSION: \"$B\"/" project.yml
XG=$(command -v xcodegen || echo /usr/local/bin/xcodegen)
"$XG" generate --quiet
echo "web ok, version $V ($B)"
