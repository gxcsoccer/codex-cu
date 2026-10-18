// swift-tools-version: 5.9
import PackageDescription

let package = Package(
  name: "CodexCU",
  platforms: [.macOS(.v14)],
  products: [
    .executable(name: "CodexCU", targets: ["CodexCU"]),
    .library(name: "CodexCUCore", targets: ["CodexCUCore"]),
  ],
  targets: [
    .target(name: "CodexCUCore", path: "Sources/CodexCUCore", resources: [.copy("Resources/AppInstructions")]),
    .executableTarget(name: "CodexCU", dependencies: ["CodexCUCore"], path: "Sources/CodexCU"),
    .testTarget(name: "CodexCUTests", dependencies: ["CodexCUCore"], path: "Tests/CodexCUTests"),
  ]
)
