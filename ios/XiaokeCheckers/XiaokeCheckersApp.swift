import AVFoundation
import SwiftUI
import UIKit
import WebKit

/// 小柯機器人跳棋遊戲 — iPad 版
/// WKWebView 開啟 App 內建的遊戲網頁（和電腦版同一份程式），由 LocalServer 在 127.0.0.1 提供。
/// iPad 橫放（電腦版版面）；下棋時螢幕保持亮著。App 被關掉時網頁一起結束：AI、音樂、語音通話全部停止。
@main
struct XiaokeCheckersApp: App {
    init() {
        LocalServer.shared.start()
        UIApplication.shared.isIdleTimerDisabled = true
        // 背景音樂、彈珠音效：靜音開關打開時也要有聲音（和一般遊戲一樣）；語音通話時 WebKit 會自己切換成收音模式
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [.mixWithOthers])
        try? AVAudioSession.sharedInstance().setActive(true)
    }

    var body: some Scene {
        WindowGroup {
            WebContainer()
                .background(Color(red: 0.106, green: 0.078, blue: 0.063))
                .ignoresSafeArea(.container, edges: .bottom)
                .statusBarHidden(true)
                .persistentSystemOverlays(.hidden)
        }
    }
}

struct WebContainer: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView { Web.shared.view }
    func updateUIView(_ v: WKWebView, context: Context) {}
}

/// 網頁與 App 之間的橋：網頁呼叫 window.webkit.messageHandlers.xkj.postMessage({cmd, args})，回傳 Promise
final class Web: NSObject, WKScriptMessageHandlerWithReply, WKNavigationDelegate, WKUIDelegate {
    static let shared = Web()
    let view: WKWebView
    private var saves: [String: (url: URL, handle: FileHandle, name: String)] = [:]

    override init() {
        let cfg = WKWebViewConfiguration()
        cfg.allowsInlineMediaPlayback = true
        cfg.mediaTypesRequiringUserActionForPlayback = []
        cfg.websiteDataStore = .default()
        // 讓網頁知道自己在 iPad App 裡（js/xk-mobile.js 會改用 App 的存檔、開網址功能）
        // 網頁的錯誤訊息轉到 iOS 系統記錄（除錯：log show --predicate 'process == "XiaokeCheckers"'）
        let shim = WKUserScript(source: """
            window.XiaokeIOS = true;
            (function () {
              function send(k, a) { try { window.webkit.messageHandlers.xkj.postMessage({ cmd: 'log', args: [k, Array.prototype.map.call(a, function (x) { return x && x.stack ? x.stack : String(x); }).join(' ')] }); } catch (e) {} }
              var ce = console.error.bind(console);
              console.error = function () { send('error', arguments); ce.apply(null, arguments); };
              window.addEventListener('error', function (e) { send('pageerror', [e.message + ' @' + e.filename + ':' + e.lineno]); });
              window.addEventListener('unhandledrejection', function (e) { send('rejection', [e.reason]); });
            })();
            """, injectionTime: .atDocumentStart, forMainFrameOnly: true)
        cfg.userContentController.addUserScript(shim)
        view = WKWebView(frame: .zero, configuration: cfg)
        super.init()
        cfg.userContentController.addScriptMessageHandler(self, contentWorld: .page, name: "xkj")
        view.navigationDelegate = self
        view.uiDelegate = self
        view.isOpaque = false
        view.backgroundColor = UIColor(red: 0.106, green: 0.078, blue: 0.063, alpha: 1)
        view.scrollView.backgroundColor = view.backgroundColor
        view.scrollView.isScrollEnabled = true
        view.scrollView.bounces = false
        view.scrollView.contentInsetAdjustmentBehavior = .never
        if #available(iOS 16.4, *) { view.isInspectable = true }
        view.load(URLRequest(url: LocalServer.shared.url))
    }

    // 外部連結（GitHub、Claude 主控台）用 Safari 開
    func webView(_ w: WKWebView, decidePolicyFor a: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let u = a.request.url, u.host != "127.0.0.1", u.scheme?.hasPrefix("http") == true, a.targetFrame?.isMainFrame != false {
            UIApplication.shared.open(u); decisionHandler(.cancel); return
        }
        decisionHandler(.allow)
    }
    func webView(_ w: WKWebView, createWebViewWith c: WKWebViewConfiguration, for a: WKNavigationAction, windowFeatures f: WKWindowFeatures) -> WKWebView? {
        if let u = a.request.url { UIApplication.shared.open(u) }
        return nil
    }

    // 語音通話要用麥克風：系統會先問一次 App 的權限，網頁這邊直接允許
    func webView(_ w: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo,
                 type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(origin.host == "127.0.0.1" && type == .microphone ? .grant : .deny)
    }

    // 網頁被系統回收時（記憶體不足）自動重新載入
    func webViewWebContentProcessDidTerminate(_ w: WKWebView) { w.reload() }

    // MARK: 網頁呼叫的功能
    func userContentController(_ u: WKUserContentController, didReceive m: WKScriptMessage, replyHandler: @escaping (Any?, String?) -> Void) {
        guard let body = m.body as? [String: Any], let cmd = body["cmd"] as? String else { replyHandler(nil, "bad message"); return }
        let args = body["args"] as? [Any] ?? []
        let s = { (i: Int) -> String in args.count > i ? "\(args[i])" : "" }
        let ver = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0"
        switch cmd {
        case "app_info":
            replyHandler(["status": "ok", "name": "小柯跳棋", "version": ver, "platform": "ios", "model": UIDevice.current.model], nil)
        case "begin_save":
            // 匯出棋譜：先寫到暫存檔，結束時打開分享選單（儲存到檔案、AirDrop、LINE…）
            let name = s(0).replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: ":", with: "_")
            let dir = FileManager.default.temporaryDirectory.appendingPathComponent("export", isDirectory: true)
            try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
            let url = dir.appendingPathComponent(name.isEmpty ? "跳棋棋譜.txt" : name)
            try? FileManager.default.removeItem(at: url)
            FileManager.default.createFile(atPath: url.path, contents: nil)
            guard let h = try? FileHandle(forWritingTo: url) else { replyHandler(["status": "error", "message": "無法建立檔案"], nil); return }
            let token = UUID().uuidString
            saves[token] = (url, h, url.lastPathComponent)
            replyHandler(["status": "ok", "token": token, "path": url.lastPathComponent], nil)
        case "write_chunk":
            guard let sv = saves[s(0)], let d = Data(base64Encoded: s(1)) else { replyHandler(["status": "error", "message": "no session"], nil); return }
            sv.handle.write(d)
            replyHandler(["status": "ok"], nil)
        case "end_save":
            guard let sv = saves.removeValue(forKey: s(0)) else { replyHandler(["status": "error", "message": "no session"], nil); return }
            try? sv.handle.close()
            share(sv.url) { done in replyHandler(done ? ["status": "ok", "path": sv.name] : ["status": "declined"], nil) }
        case "log":
            NSLog("[web %@] %@", s(0), s(1))
            replyHandler(true, nil)
        case "open_url":
            if let u = URL(string: s(0)), ["github.com", "achir1015.github.io", "console.anthropic.com", "apps.apple.com"].contains(u.host ?? "") { UIApplication.shared.open(u) }
            replyHandler(true, nil)
        default:
            replyHandler(nil, "unknown command \(cmd)")
        }
    }

    private func share(_ url: URL, done: @escaping (Bool) -> Void) {
        let vc = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        vc.completionWithItemsHandler = { _, completed, _, _ in done(completed) }
        if let p = vc.popoverPresentationController {   // iPad：從畫面中央彈出
            p.sourceView = view
            p.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
            p.permittedArrowDirections = []
        }
        present(vc) { done(false) }
    }

    private func present(_ vc: UIViewController, fail: () -> Void) {
        let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        var top = scene?.windows.first(where: { $0.isKeyWindow })?.rootViewController
        while let p = top?.presentedViewController { top = p }
        if let top { top.present(vc, animated: true) } else { fail() }
    }
}
