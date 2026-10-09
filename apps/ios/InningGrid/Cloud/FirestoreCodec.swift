import Foundation

/// Converts between plain JSON documents and Firestore's REST value format.
///
/// The REST API wraps every value in its type — `{"stringValue": "x"}`,
/// `{"integerValue": "6"}` — where the web SDK hides all of that. The rules
/// here exist to make a document written from iOS indistinguishable from the
/// same document written by the website:
///
///  - A whole number is written as `integerValue`, anything else as
///    `doubleValue`. That is what the JavaScript SDK does with a JS number, so
///    `plannedInnings: 6` stays an integer whichever app saved it last.
///  - `undefined` never reaches here — JSON has no such thing — and the web
///    saves with `ignoreUndefinedProperties`, so absent fields stay absent on
///    both sides instead of becoming nulls on one.
///  - A Firestore timestamp read back becomes the ISO string the domain types
///    expect. The app never writes one; dates in this schema are strings.
enum FirestoreCodec {
    // MARK: Encode (JSON → Firestore)

    static func encode(_ object: JSONObject) -> [String: Any] {
        object.mapValues(encodeValue)
    }

    static func encodeValue(_ value: JSONValue) -> [String: Any] {
        switch value {
        case .null:
            return ["nullValue": NSNull()]
        case .bool(let bool):
            return ["booleanValue": bool]
        case .number(let number):
            /* 2^53: beyond it a Double cannot hold every integer exactly, and the
               JS SDK switches to doubles at the same point. */
            if number.rounded() == number, abs(number) < 9_007_199_254_740_992 {
                return ["integerValue": String(Int64(number))]
            }
            return ["doubleValue": number]
        case .string(let string):
            return ["stringValue": string]
        case .array(let values):
            /* An empty array is `arrayValue: {}`, not `values: []` — Firestore
               rejects the second form. */
            return values.isEmpty
                ? ["arrayValue": [String: Any]()]
                : ["arrayValue": ["values": values.map(encodeValue)]]
        case .object(let fields):
            return fields.isEmpty
                ? ["mapValue": [String: Any]()]
                : ["mapValue": ["fields": encode(fields)]]
        }
    }

    // MARK: Decode (Firestore → JSON)

    static func decode(fields: [String: Any]?) -> JSONObject {
        guard let fields else { return [:] }
        var out: JSONObject = [:]
        for (key, raw) in fields {
            if let typed = raw as? [String: Any] { out[key] = decodeValue(typed) }
        }
        return out
    }

    static func decodeValue(_ typed: [String: Any]) -> JSONValue {
        if typed["nullValue"] != nil { return .null }
        if let bool = typed["booleanValue"] as? Bool { return .bool(bool) }
        if let integer = typed["integerValue"] as? String, let number = Double(integer) {
            return .number(number)
        }
        if let integer = typed["integerValue"] as? NSNumber { return .number(integer.doubleValue) }
        if let double = typed["doubleValue"] as? NSNumber { return .number(double.doubleValue) }
        /* NaN and the infinities arrive as strings. None should exist in this
           schema; keep them as numbers rather than guess. */
        if let special = typed["doubleValue"] as? String {
            return .number(Double(special) ?? .nan)
        }
        if let string = typed["stringValue"] as? String { return .string(string) }
        if let timestamp = typed["timestampValue"] as? String { return .string(timestamp) }
        if let reference = typed["referenceValue"] as? String { return .string(reference) }
        if let array = typed["arrayValue"] as? [String: Any] {
            let values = (array["values"] as? [[String: Any]]) ?? []
            return .array(values.map(decodeValue))
        }
        if let map = typed["mapValue"] as? [String: Any] {
            return .object(decode(fields: map["fields"] as? [String: Any]))
        }
        return .null
    }
}

/// One document as the REST API returns it.
struct FirestoreDocument: Sendable, Hashable {
    /// The path below `/documents`, e.g. `teams/t1/games/g1`.
    let path: String
    let fields: JSONObject
    /// Firestore's last-write time. Sent back as a precondition on save, which
    /// is how a change made elsewhere is caught instead of overwritten.
    let updateTime: String?

    var id: String { String(path.split(separator: "/").last ?? "") }

    init(path: String, fields: JSONObject, updateTime: String?) {
        self.path = path
        self.fields = fields
        self.updateTime = updateTime
    }

    /// From a REST `Document` resource.
    init?(rest: [String: Any], databasePath: String) {
        guard let name = rest["name"] as? String else { return nil }
        let prefix = "\(databasePath)/documents/"
        path = name.hasPrefix(prefix) ? String(name.dropFirst(prefix.count)) : name
        fields = FirestoreCodec.decode(fields: rest["fields"] as? [String: Any])
        updateTime = rest["updateTime"] as? String
    }

    /// The document as the domain type the web reads: its fields plus its id.
    ///
    /// The web store spreads `{ ...data(), id }`, so an object read from either
    /// app has `id` set from the path even if the stored fields lack it.
    var object: JSONValue {
        var merged = fields
        merged["id"] = .string(id)
        return .object(merged)
    }
}
