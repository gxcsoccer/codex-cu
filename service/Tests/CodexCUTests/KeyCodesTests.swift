import Testing
import CoreGraphics
@testable import CodexCUCore

@Test func parsesModifiersAndLetters() throws {
  let chord = try KeyCodes.parse("cmd+shift+g")
  #expect(chord.key == 5)
  #expect(chord.flags.contains(.maskCommand))
  #expect(chord.flags.contains(.maskShift))
}

@Test func parsesNamedKeys() throws {
  #expect(try KeyCodes.parse("return").key == 36)
  #expect(try KeyCodes.parse("escape").key == 53)
  #expect(try KeyCodes.parse("f5").key == 96)
  #expect(try KeyCodes.parse("cmd+alt+right").key == 124)
}

@Test func rejectsUnknownKeysAndModifiers() {
  #expect(throws: ServiceError.self) { _ = try KeyCodes.parse("hyper+x") }
  #expect(throws: ServiceError.self) { _ = try KeyCodes.parse("cmd+") }
}
