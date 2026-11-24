import Foundation
import Security

/// Keeps the credential in the login Keychain, as one generic password item.
public struct CredentialStore: Sendable {
    public let service: String
    let account = "credential"

    public init(service: String) {
        self.service = service
    }

    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: account]
    }

    /// The stored credential, or nil when there is none. A stored item that can't be read throws.
    public func load() throws -> Credential? {
        var lookup = query
        lookup[kSecReturnData as String] = true
        lookup[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(lookup as CFDictionary, &result)
        if status == errSecItemNotFound { return nil }
        guard status == errSecSuccess, let data = result as? Data else { throw KeychainError(status: status, action: "read") }
        return try JSONDecoder().decode(Credential.self, from: data)
    }

    public func save(_ credential: Credential) throws {
        let data = try JSONEncoder().encode(credential)
        let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
        if status == errSecItemNotFound {
            var add = query
            add[kSecValueData as String] = data
            add[kSecAttrLabel as String] = "Swipe List credential"
            let added = SecItemAdd(add as CFDictionary, nil)
            guard added == errSecSuccess else { throw KeychainError(status: added, action: "save") }
        } else if status != errSecSuccess {
            throw KeychainError(status: status, action: "save")
        }
    }

    public func delete() throws {
        let status = SecItemDelete(query as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else { throw KeychainError(status: status, action: "delete") }
    }
}

public struct KeychainError: Error, LocalizedError {
    public let status: OSStatus
    public let action: String

    public var errorDescription: String? {
        let reason = SecCopyErrorMessageString(status, nil) as String? ?? "status \(status)"
        return "Could not \(action) the credential in the Keychain: \(reason)"
    }
}
