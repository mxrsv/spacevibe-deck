import CryptoKit
import Foundation
import UserNotifications

// Decrypts the sealed push (mobile/protocol/src/push.ts) into the real notification copy.
//
// Payload from the relay: { aps: {...generic...}, d: { p: <pairingId>, c: <sealed> } }.
// `c` = base64url( nonce[12] || ChaCha20-Poly1305 ciphertext || tag[16] ), AAD "deck/v1/push".
// The push key lives in the shared Keychain, written by the app with expo-secure-store:
//   keychainService "dev.spacevibe.deck.mobile.push" (the library appends ":no-auth"),
//   key = the pairing id, value = base64url of the 32-byte push key, AFTER_FIRST_UNLOCK,
//   access group = the app's shared group (Info.plist DeckKeychainAccessGroup).
// expo-secure-store stores the key as kSecAttrGeneric (and kSecAttrAccount) bytes, so the item is
// found by service + generic. On any failure the original generic notification is delivered.
// Nothing decrypted is ever logged.
class NotificationService: UNNotificationServiceExtension {
  private static let pushKeychainService = "dev.spacevibe.deck.mobile.push:no-auth"
  private static let accessGroupInfoKey = "DeckKeychainAccessGroup"
  private static let aad = Data("deck/v1/push".utf8)
  private static let nonceLength = 12
  private static let tagLength = 16

  private var contentHandler: ((UNNotificationContent) -> Void)?
  private var original: UNNotificationContent?
  private var delivered = false

  override func didReceive(
    _ request: UNNotificationRequest,
    withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
  ) {
    self.contentHandler = contentHandler
    // `paneId`, `pairingId` and `kind` are never set by this extension and the app never reads
    // them: they are removed from whatever arrived, so a relay cannot pre-fill a route. The app
    // opens the sealed `d.c` itself when the notification is tapped.
    self.original = Self.stripped(request.content)
    guard let mutable = request.content.mutableCopy() as? UNMutableNotificationContent else {
      deliver(request.content)
      return
    }
    let d = request.content.userInfo["d"] as? [String: Any]
    guard let pairingId = d?["p"] as? String,
      let sealed = d?["c"] as? String,
      let payload = Self.open(pairingId: pairingId, sealed: sealed)
    else {
      deliver(Self.stripped(request.content))
      return
    }
    mutable.title = payload.title
    mutable.body = payload.body
    var userInfo = mutable.userInfo
    for key in Self.untrustedKeys { userInfo.removeValue(forKey: key) }
    mutable.userInfo = userInfo
    deliver(mutable)
  }

  private static let untrustedKeys = ["paneId", "pairingId", "kind"]

  /// The notification with every key the app might mistake for a decrypted route removed.
  private static func stripped(_ content: UNNotificationContent) -> UNNotificationContent {
    guard let copy = content.mutableCopy() as? UNMutableNotificationContent else { return content }
    var info = copy.userInfo
    for key in untrustedKeys { info.removeValue(forKey: key) }
    copy.userInfo = info
    return copy
  }

  override func serviceExtensionTimeWillExpire() {
    if let original { deliver(original) }
  }

  private func deliver(_ content: UNNotificationContent) {
    guard !delivered, let handler = contentHandler else { return }
    delivered = true
    handler(content)
  }

  private struct Payload {
    let title: String
    let body: String
    let paneId: Int
    let kind: String
  }

  private static func open(pairingId: String, sealed: String) -> Payload? {
    guard let key = pushKey(for: pairingId),
      let bytes = base64urlDecode(sealed),
      bytes.count > nonceLength + tagLength,
      let nonce = try? ChaChaPoly.Nonce(data: bytes.prefix(nonceLength)),
      let box = try? ChaChaPoly.SealedBox(
        nonce: nonce,
        ciphertext: bytes.dropFirst(nonceLength).dropLast(tagLength),
        tag: bytes.suffix(tagLength)),
      let plain = try? ChaChaPoly.open(box, using: SymmetricKey(data: key), authenticating: aad),
      let json = try? JSONSerialization.jsonObject(with: plain) as? [String: Any],
      let title = json["title"] as? String,
      let body = json["body"] as? String,
      let paneId = json["paneId"] as? Int,
      let kind = json["kind"] as? String
    else { return nil }
    return Payload(title: title, body: body, paneId: paneId, kind: kind)
  }

  private static func pushKey(for pairingId: String) -> Data? {
    var query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: pushKeychainService,
      kSecAttrGeneric as String: Data(pairingId.utf8),
      kSecMatchLimit as String: kSecMatchLimitOne,
      kSecReturnData as String: true,
    ]
    if let group = Bundle.main.object(forInfoDictionaryKey: accessGroupInfoKey) as? String,
      !group.isEmpty
    {
      query[kSecAttrAccessGroup as String] = group
    }
    var item: CFTypeRef?
    guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
      let stored = item as? Data,
      let text = String(data: stored, encoding: .utf8),
      let key = base64urlDecode(text),
      key.count == 32
    else { return nil }
    return key
  }

  private static func base64urlDecode(_ text: String) -> Data? {
    var base64 = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    base64 += String(repeating: "=", count: (4 - base64.count % 4) % 4)
    return Data(base64Encoded: base64)
  }
}
