-- 在 Mac 畫面上的「終端機」執行一行指令（登入工作階段裡鑰匙圈是開的，xcodebuild 才能簽章）
-- 用法：osascript ios/run-in-terminal.applescript "bash ~/Developer/xiaoke-checkers/ios/build-ipa.sh"
on run argv
	tell application "Terminal"
		activate
		do script (item 1 of argv)
	end tell
	return "started"
end run
