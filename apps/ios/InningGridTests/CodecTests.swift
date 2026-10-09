import XCTest
@testable import InningGrid

/// Firestore's typed values, as the website's SDK writes and reads them.
final class CodecTests: XCTestCase {
    func testRoundTripsEveryKindOfValue() {
        let object: JSONObject = [
            "name": "Balsam Waters",
            "innings": 6,
            "score": 83.5,
            "active": true,
            "note": .null,
            "tags": ["a", "b"],
            "empty": .array([]),
            "nested": ["inning": 3, "map": .object([:])],
        ]
        let decoded = FirestoreCodec.decode(fields: FirestoreCodec.encode(object))
        XCTAssertEqual(decoded, object)
    }

    func testWholeNumbersAreIntegers() {
        /* The JS SDK writes 6 as integerValue; a doubleValue would read back
           as 6 too, but would make iOS-saved documents differ. */
        let encoded = FirestoreCodec.encodeValue(.number(6))
        XCTAssertEqual(encoded["integerValue"] as? String, "6")
        XCTAssertNotNil(FirestoreCodec.encodeValue(.number(2.5))["doubleValue"])
    }

    func testReadsIntegersSentAsStrings() {
        XCTAssertEqual(FirestoreCodec.decodeValue(["integerValue": "42"]), .number(42))
    }

    func testQuotesFieldPathsThatNeedIt() {
        XCTAssertEqual(FirestoreClient.quotePath("roles.abc-123"), "roles.`abc-123`")
        XCTAssertEqual(FirestoreClient.quotePath("note"), "note")
    }
}
