import Foundation

public final class Server {
  private let socketPath: String
  private let handlers: ServiceHandlers
  private var listenFD: Int32 = -1

  public init(socketPath: String, handlers: ServiceHandlers = DefaultHandlers()) {
    self.socketPath = socketPath
    self.handlers = handlers
  }

  public func start() throws {
    unlink(socketPath)
    let fd = socket(AF_UNIX, SOCK_STREAM, 0)
    guard fd >= 0 else { throw ServiceError(.unknownError, "socket() failed: \(errno)") }

    var address = sockaddr_un()
    address.sun_family = sa_family_t(AF_UNIX)
    let pathBytes = Array(socketPath.utf8CString)
    guard pathBytes.count <= MemoryLayout.size(ofValue: address.sun_path) else {
      throw ServiceError(.unknownError, "socket path too long: \(socketPath)")
    }
    withUnsafeMutableBytes(of: &address.sun_path) { destination in
      pathBytes.withUnsafeBytes { source in
        destination.copyBytes(from: source.prefix(destination.count))
      }
    }

    let size = socklen_t(MemoryLayout<sockaddr_un>.size)
    let bound = withUnsafePointer(to: &address) { pointer in
      pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, size) }
    }
    guard bound == 0 else {
      close(fd)
      throw ServiceError(.unknownError, "bind() failed: \(errno)")
    }
    guard listen(fd, 16) == 0 else {
      close(fd)
      throw ServiceError(.unknownError, "listen() failed: \(errno)")
    }
    listenFD = fd
  }

  public func run() throws {
    if listenFD < 0 { try start() }
    while true {
      let client = accept(listenFD, nil, nil)
      guard client >= 0 else { continue }
      DispatchQueue.global().async { [handlers] in
        Self.serve(client: client, handlers: handlers)
      }
    }
  }

  public func stop() {
    if listenFD >= 0 { close(listenFD); listenFD = -1 }
    unlink(socketPath)
  }

  static func serve(client: Int32, handlers: ServiceHandlers) {
    let handle = FileHandle(fileDescriptor: client, closeOnDealloc: true)
    let reader = FrameReader(handle: handle)
    while true {
      let message: Any?
      do {
        message = try reader.nextFrame()
      } catch {
        return
      }
      guard let message else { return }
      guard let object = message as? [String: Any] else { continue }
      guard let response = RPC.handle(object, handlers: handlers) else { continue }
      guard let data = try? Framing.encode(response) else { return }
      do {
        try handle.write(contentsOf: data)
      } catch {
        return
      }
    }
  }
}
