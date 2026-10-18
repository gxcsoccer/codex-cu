import Testing
import ApplicationServices
@testable import CodexCUCore

@Test func idsAreStableAndMonotonic() {
  let registry = AXIDRegistry()
  let first = AXUIElementCreateSystemWide()
  let second = AXUIElementCreateApplication(getpid())
  let a = registry.id(for: first)
  let b = registry.id(for: second)
  #expect(a != b)
  #expect(registry.id(for: first) == a)
  #expect(registry.id(for: second) == b)
  #expect(registry.id(for: first) == a)
  #expect(a < b)
}
