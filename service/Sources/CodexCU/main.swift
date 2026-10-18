import AppKit
import Foundation
import CodexCUCore

var socketPath = "/tmp/codex-cu.sock"
var approvalsPath: String?
var instructionsPath: String?
var launchTimeout: TimeInterval = 5
var enableAudio = false
var arguments = Array(CommandLine.arguments.dropFirst())
while let argument = arguments.first {
  arguments.removeFirst()
  switch argument {
  case "--socket":
    guard let value = arguments.first else {
      FileHandle.standardError.write(Data("--socket requires a path\n".utf8))
      exit(2)
    }
    arguments.removeFirst()
    socketPath = value
  case "--audio":
    enableAudio = true
  case "--instructions":
    guard let value = arguments.first else {
      FileHandle.standardError.write(Data("--instructions requires a path\n".utf8))
      exit(2)
    }
    arguments.removeFirst()
    instructionsPath = value
  case "--launch-timeout":
    guard let value = arguments.first, let seconds = TimeInterval(value) else {
      FileHandle.standardError.write(Data("--launch-timeout requires seconds\n".utf8))
      exit(2)
    }
    arguments.removeFirst()
    launchTimeout = seconds
  case "--approvals":
    guard let value = arguments.first else {
      FileHandle.standardError.write(Data("--approvals requires a path\n".utf8))
      exit(2)
    }
    arguments.removeFirst()
    approvalsPath = value
  case "--help", "-h":
    print("usage: CodexCU [--socket PATH] [--approvals PATH] [--instructions PATH] [--launch-timeout SECONDS] [--audio]")
    exit(0)
  default:
    FileHandle.standardError.write(Data("unknown argument: \(argument)\n".utf8))
    exit(2)
  }
}

var instructions: [String: String] = [:]
if let instructionsPath {
  do {
    instructions = try DefaultHandlers.loadInstructions(at: URL(fileURLWithPath: instructionsPath))
  } catch {
    FileHandle.standardError.write(Data("fatal: \(error)\n".utf8))
    exit(1)
  }
}
// ScreenCaptureKit's window filter needs a WindowServer connection; a plain CLI
// process aborts in CGS_REQUIRE_INIT without it. Initializing NSApplication is
// the supported way to establish that connection.
_ = NSApplication.shared
NSApplication.shared.setActivationPolicy(.prohibited)

let handlers = DefaultHandlers(
  approvalsURL: approvalsPath.map { URL(fileURLWithPath: $0) },
  launchTimeout: launchTimeout,
  instructions: instructions,
  audioRecorder: enableAudio ? SystemAudioRecorder() : nil,
)
let server = Server(socketPath: socketPath, handlers: handlers)
do {
  try server.start()
  print("CodexCU listening on \(socketPath)")
  try server.run()
} catch {
  FileHandle.standardError.write(Data("fatal: \(error)\n".utf8))
  exit(1)
}
