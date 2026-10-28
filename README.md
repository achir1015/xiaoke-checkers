# 小柯機器人跳棋遊戲
<img width="1914" height="1079" alt="image" src="https://github.com/user-attachments/assets/1394e184-6cd4-4a81-8e5a-15b937461eab" />
視頻示範

https://github.com/user-attachments/assets/5b4cd40d-3b73-4479-a5a3-8311c30b73ae

3D 中國跳棋：桌面版（Windows 11／macOS）、Android 手機版、iPhone／iPad 版。

**系統開發：吳玉柱 先生 與 Claude AI Opus 5.5**

## 玩法

- 六角星棋盤共 121 孔，最多三組參賽（紅、綠、藍），每組 10 顆棋子從自己的角出發。
- 先把 10 顆棋子全部移到正對面的角就獲勝（對面角被填滿、且其中有自己的棋子也算贏，避免有人故意佔角不走）。
- 每回合移動一顆棋子：
  - 走到相鄰的空孔；或
  - **跳**：沿直線跳過緊鄰的**一顆**棋子，落在它正後方的空孔。跳躍一定走直線、不能轉彎；中間隔了兩顆以上就擋住了，不能跳。落下後可以接著再跳（連跳）。
- 2 人時兩人對角；3 人時隔角而坐，各自的目標角都是空角。
- 比賽時只有輪到的人（主控權者）可以用滑鼠下棋，其他人都是觀棋者。

## 模式

| 模式 | 說明 |
|---|---|
| A 與 AI 對賽 | 不需網路，2 或 3 人，AI 五種難度（入門、初級、中級、高級、大師），可悔棋、提示 |
| B 遠端對賽 | 建立房間取得 6 位數房號，邀請一位或兩位朋友參賽；空位開始時由 AI 代下；比賽開始後加入的人成為觀棋者；有人斷線由 AI 暫代、重新連線可接回座位；多人語音通話＋文字聊天 |
| C AI 與 AI 對賽 | 2 或 3 個 AI 互相比賽，可調速度、暫停 |

其他：AI 軍師（本機 AI 分析，設定 Anthropic API 金鑰後由 Claude 白話解說）、20 首原創背景音樂（每首 3 分多鐘，可加入自己的音樂）、棋譜庫（自動收錄、重播、匯出、匯入）、版本自動更新。

## 手機與平板

| 裝置 | 安裝 | 畫面 |
|---|---|---|
| Android 手機 | 在手機下載 Release 裡的 `XiaokeCheckers-版本-android.apk` 安裝（第一次要允許「安裝未知應用程式」） | 直立：上面玩家、中間棋盤、下面按鈕；走法／軍師／對話／音樂在底部抽屜 |
| iPhone | 用 Safari 開 <https://achir1015.github.io/xiaoke-checkers/ios/> 按「安裝」 | 直立，同 Android |
| iPad | 同上 | 橫放，和電腦版同一個畫面 |

- 手指點棋子、再點落點；兩指拖曳旋轉、捏合縮放。手機預設俯視，棋盤最大。
- 電腦、Android、iPhone、iPad 都能互相遠端對賽、觀棋、語音聊天（同一套連線方式）。
- iPhone／iPad 版在 App Store 上架前，只能裝在開發者登記過的裝置；第一次打開若要求「開發者模式」，到「設定 → 隱私權與安全性」打開。
- 遊戲裡「關於 → 檢查更新」：Android 直接下載新版 APK 安裝；iPhone／iPad 開安裝頁更新。棋譜與設定都會保留。

## AI

參考 [Crazylitm/jumpchess](https://github.com/Crazylitm/jumpchess) 的說明：

- 跳棋比較像競速遊戲，估值函數各玩家獨立，只看自己的棋子：前進得分、偏離中線扣分、最後一顆棋子（落後者）扣分。
- 搜尋時每位玩家都選對自己最有利的分支（max-n），深度＝人數＋等級加深；最後一層只取每位玩家下一步的最大收益。
- 搜尋中提早完成的分支有獎勵分數，鼓勵最早完成；分數相同時隨機選擇。

棋盤參考：[ghh3809/Chinese-Checkers](https://github.com/ghh3809/Chinese-Checkers)。

## 開發

```bash
npm install
npm start            # 開發模式執行
npm test             # 規則與 AI 測試
npm run e2e          # 端對端測試（單機＋三人連線）
npm run dist:win     # 建置 Windows 安裝檔
npm run music        # 重新產生 20 首背景音樂（需要 Python numpy/scipy 與 ffmpeg）
npm run icon         # 重新產生圖示
node scripts/build-mobile.mjs   # 產生手機／平板版網頁 mobile/www
node e2e/ipad.mjs               # 用 Chrome 模擬 iPad 測試
node e2e/mobile.mjs             # 用 Chrome 模擬 Android 手機與 iPhone 測試
python android/build.py         # 建置 Android APK（不用 Gradle；debug install 會裝到接著的手機）
node e2e/phone.mjs              # 實機測試（除錯版 APK）
node e2e/cross.mjs              # 手機開房、電腦加入的互通測試
```

iPhone／iPad 版（ios/，XcodeGen）：在 Mac 上 `bash ios/sync.sh` 產生 Xcode 專案；`bash ios/build-ipa.sh`（要在 Mac 畫面的終端機執行）匯出 Ad Hoc 的 `xiaoke-checkers-ios.ipa`，上傳到 Release 後安裝頁就會裝到最新版（新版要改 `docs/ios/manifest.plist` 的 bundle-version）。

推送到 `main` 後，GitHub Actions 會自動建置 Windows 與 macOS 安裝檔並發佈 Release（版本號取自 `package.json`）；程式內的「關於與更新」會從 Release 下載新版。
