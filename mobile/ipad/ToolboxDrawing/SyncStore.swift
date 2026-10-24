import Foundation
import Security

enum DrawingError: LocalizedError {
    case message(String)
    var errorDescription: String? { if case .message(let text) = self { return text }; return nil }
}

@MainActor final class SyncStore {
    var pages: [String: [String: Any]] = [:]
    var objects: [String: [String: Any]] = [:]
    var pending: [[String: Any]] = []
    var identity = "未配对"
    var note = "请扫描或粘贴电脑的绘图配对地址"
    var changed: (() -> Void)?
    var online = false
    private(set) var base: URL?
    private var deviceID = ""
    private var token = ""
    private let client = UUID().uuidString
    private var streamTask: Task<Void, Never>?
    private var flushTask: Task<Void, Never>?
    private var generation = 0
    private var file: URL {
        FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("notebook-\(deviceID).json")
    }
    init() {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "cn.macpe.toolbox.drawing", kSecAttrAccount as String: "pairing", kSecReturnData as String: true]
        var result: CFTypeRef?
        if SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess,
           let data = result as? Data, let url = String(data: data, encoding: .utf8) { try? pair(url, remember: false) }
    }
    func pair(_ text: String, remember: Bool = true) throws {
        guard let url = URL(string: text.trimmingCharacters(in: .whitespacesAndNewlines)), url.scheme == "http", let host = url.host,
              url.user == nil, url.password == nil, let parts = URLComponents(string: "?" + (url.fragment ?? ""))?.queryItems,
              let id = parts.first(where: { $0.name == "id" })?.value,
              let secret = parts.first(where: { $0.name == "token" })?.value,
              id.range(of: "^[A-Za-z0-9_-]{1,80}$", options: .regularExpression) != nil,
              secret.range(of: "^[A-Za-z0-9_-]{43}$", options: .regularExpression) != nil else { throw DrawingError.message("请粘贴电脑「同步绘图」中的完整配对地址") }
        let octets = host.split(separator: ".").compactMap { Int($0) }
        let localIP = octets.count == 4 && octets.allSatisfy { (0...255).contains($0) } &&
            (octets[0] == 10 || octets[0] == 26 || octets[0] == 127 || octets[0] == 192 && octets[1] == 168 || octets[0] == 172 && (16...31).contains(octets[1]) || octets[0] == 100 && (64...127).contains(octets[1]))
        guard localIP || host.hasSuffix(".local") else { throw DrawingError.message("仅连接局域网或设备 VPN 地址") }
        var components = URLComponents(); components.scheme = "http"; components.host = host; components.port = url.port ?? 43128
        guard let address = components.url else { throw DrawingError.message("连接地址无效") }
        stop(); base = address; deviceID = id; token = secret; pages = [:]; objects = [:]; pending = []
        if FileManager.default.fileExists(atPath: file.path) {
            let data = try Data(contentsOf: file)
            guard let saved = try JSONSerialization.jsonObject(with: data) as? [String: Any] else { throw DrawingError.message("本地绘图缓存损坏，请先导出备份") }
            pages = saved["pages"] as? [String: [String: Any]] ?? [:]; objects = saved["objects"] as? [String: [String: Any]] ?? [:]; pending = saved["pending"] as? [[String: Any]] ?? []
        }
        if remember {
            let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "cn.macpe.toolbox.drawing", kSecAttrAccount as String: "pairing"]
            let attrs: [String: Any] = [kSecValueData as String: Data(text.utf8), kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
            let result = SecItemUpdate(query as CFDictionary, attrs as CFDictionary)
            if result == errSecItemNotFound { let status = SecItemAdd(query.merging(attrs) { _, new in new } as CFDictionary, nil); guard status == errSecSuccess else { throw DrawingError.message("无法安全保存配对信息") } }
            else if result != errSecSuccess { throw DrawingError.message("无法更新配对信息") }
        }
        start(); changed?()
    }
    func persist() throws {
        let data = try JSONSerialization.data(withJSONObject: ["version": 1, "pages": pages, "objects": objects, "pending": pending])
        try data.write(to: file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }
    func request(_ route: String, method: String = "GET", body: Data? = nil) throws -> URLRequest {
        guard let base else { throw DrawingError.message("尚未配对") }
        var req = URLRequest(url: base.appendingPathComponent(route)); req.httpMethod = method; req.httpBody = body; req.timeoutInterval = 20
        req.setValue("Bearer " + token, forHTTPHeaderField: "Authorization"); req.setValue(deviceID, forHTTPHeaderField: "X-Toolbox-Id"); return req
    }
    func apply(_ op: [String: Any]) {
        let kind = op["kind"] as? String
        if let value = op["value"] as? [String: Any], let id = value["id"] as? String {
            if kind == "page" { pages[id] = value }; if kind == "put" { objects[id] = value }
        }
        if kind == "remove", let target = op["target"] as? String { objects.removeValue(forKey: target) }
    }
    func enqueue(_ changes: [[String: Any]]) throws {
        guard base != nil else { throw DrawingError.message("请先配对电脑") }
        let old = pending
        pending += changes.map { change in var op = change; op["id"] = UUID().uuidString; op["client"] = client; return op }
        do { try persist() } catch { pending = old; throw error }
        for op in pending { apply(op) }; try persist(); changed?(); flush()
    }
    func stop() { generation += 1; streamTask?.cancel(); streamTask = nil; flushTask?.cancel(); flushTask = nil; online = false }
    func start() {
        guard base != nil, streamTask == nil else { return }; generation += 1; let epoch = generation
        streamTask = Task { [weak self] in
            guard let self else { return }
            while !Task.isCancelled && epoch == generation {
                do {
                    var req = try request("api/events"); req.timeoutInterval = 86400
                    let (bytes, response) = try await URLSession.shared.bytes(for: req)
                    guard let http = response as? HTTPURLResponse, http.statusCode == 200 else { throw DrawingError.message("配对失效，请重新扫描电脑二维码") }
                    var event = ""
                    for try await line in bytes.lines {
                        try Task.checkCancellation(); guard epoch == generation else { return }
                        if line.hasPrefix("event: ") { event = String(line.dropFirst(7)) }
                        // DrawingSync emits exactly one JSON data line per event.
                        // AsyncBytes.lines omits empty lines, so consume that data
                        // line directly rather than waiting for an SSE separator.
                        else if line.hasPrefix("data: ") {
                            if let data = String(line.dropFirst(6)).data(using: .utf8), let value = try JSONSerialization.jsonObject(with: data) as? [String: Any] {
                                if event == "snapshot" {
                                    pages = value["pages"] as? [String: [String: Any]] ?? [:]; objects = value["objects"] as? [String: [String: Any]] ?? [:]
                                    for op in pending { apply(op) }
                                    if let info = value["identity"] as? [String: Any] { identity = "#\(info["code"] ?? "") · \(info["name"] ?? "Toolbox")" }
                                    online = true; note = pending.isEmpty ? "已同步" : "补传笔迹中"; try persist(); flush()
                                } else if event == "operation" { apply(value); for op in pending { apply(op) }; try persist() }
                                changed?()
                            }
                            event = ""
                        }
                    }
                    throw DrawingError.message("同步连接已关闭")
                } catch { if Task.isCancelled || epoch != generation { return }; online = false; note = "连接中断：\(error.localizedDescription)；笔迹保留在本机"; changed?() }
                try? await Task.sleep(nanoseconds: 2_000_000_000)
            }
        }
    }
    private func flush() {
        guard online, flushTask == nil else { return }; let epoch = generation
        flushTask = Task { [weak self] in
            guard let self else { return }; defer { if epoch == generation { flushTask = nil } }
            do {
                while !pending.isEmpty && online && epoch == generation && !Task.isCancelled {
                    let op = pending[0], body = try JSONSerialization.data(withJSONObject: op)
                    let (data, response) = try await URLSession.shared.data(for: request("api/op", method: "POST", body: body))
                    guard epoch == generation else { return }
                    guard (response as? HTTPURLResponse)?.statusCode == 200 else { let result = try? JSONSerialization.jsonObject(with: data) as? [String: Any]; throw DrawingError.message(result?["error"] as? String ?? "同步被拒绝，待同步内容已保留") }
                    let old = pending; pending.removeAll { ($0["id"] as? String) == (op["id"] as? String) }
                    do { try persist() } catch { pending = old; throw error }
                    note = pending.isEmpty ? "已同步" : "同步中 · \(pending.count)"; changed?()
                }
            } catch { if epoch == generation { note = error.localizedDescription; changed?() } }
        }
    }
    func image(_ asset: String) async throws -> Data {
        let (data, response) = try await URLSession.shared.data(for: request("api/image/" + asset))
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw DrawingError.message("图片暂不可用") }; return data
    }
    func upload(_ data: Data) async throws -> [String: Any] {
        guard online, data.count <= 8 * 1024 * 1024 else { throw DrawingError.message("图片需要连接电脑，且不超过 8 MB") }
        let (bytes, response) = try await URLSession.shared.data(for: request("api/image", method: "POST", body: data))
        let result = try JSONSerialization.jsonObject(with: bytes) as? [String: Any] ?? [:]
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw DrawingError.message(result["error"] as? String ?? "图片上传失败") }; return result
    }
    var backupURL: URL { file }
}
