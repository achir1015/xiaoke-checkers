#!/bin/bash
# 封存並匯出 Ad Hoc 的 .ipa（iPad／iPhone 都能裝，限開發者帳號登記過的裝置）。
# 要在 Mac 的登入畫面裡（終端機 App）執行，SSH 進來的話鑰匙圈是鎖的、會簽章失敗：
#   osascript ios/run-in-terminal.applescript "bash ~/Developer/xiaoke-checkers/ios/build-ipa.sh"
# 產出：ios/build/xiaoke-checkers-ios.ipa；進度寫在 ios/build/ipa.log，完成會留下 ios/build/ipa.done（內容 ok 或 fail）
cd "$(dirname "$0")"
mkdir -p build
rm -f build/ipa.done
exec > >(tee build/ipa.log) 2>&1
set -o pipefail
fail() { echo "fail" > build/ipa.done; exit 1; }
bash sync.sh || fail
rm -rf build/XiaokeCheckers.xcarchive build/export
xcodebuild -project XiaokeCheckers.xcodeproj -scheme XiaokeCheckers -configuration Release \
  -destination 'generic/platform=iOS' -archivePath build/XiaokeCheckers.xcarchive \
  -allowProvisioningUpdates archive | grep -E 'error|warning: .*sign|ARCHIVE' || fail
xcodebuild -exportArchive -archivePath build/XiaokeCheckers.xcarchive -exportPath build/export \
  -exportOptionsPlist ExportOptions.plist -allowProvisioningUpdates || fail
IPA=$(ls build/export/*.ipa | head -1)
[ -f "$IPA" ] || fail
cp "$IPA" build/xiaoke-checkers-ios.ipa
# 列出這個 .ipa 可以安裝的裝置（UDID）
unzip -p build/xiaoke-checkers-ios.ipa 'Payload/*.app/embedded.mobileprovision' | security cms -D | plutil -extract ProvisionedDevices json -o - - || true
ls -l build/xiaoke-checkers-ios.ipa
echo "ok" > build/ipa.done
